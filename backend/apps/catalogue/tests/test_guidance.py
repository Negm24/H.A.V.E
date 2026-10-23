import json
import unittest
from unittest.mock import patch
from apps.catalogue.services.guidance_services import (
    screening, validate_answers, candidates, select_with_groq, next_with_groq, next_question_candidates, GuidanceUnavailable,
)


def answers():
    return {"areas": ["head"], "urgent": ["none"],
            "head.feel": ["ache"], "duration": ["today"], "severity": ["mild"],
            "age": ["adult"], "history": ["none"]}


def product(id=1, **overrides):
    return {"id": id, "requires_prescription": False, "stock_quantity": 4,
            "quantity_limit": 4, "active_ingredient": "Paracetamol", "strength": "500 mg", "dosage_form": "Tablets", **overrides}


class GuidanceTests(unittest.TestCase):
    def test_non_emergency_demo_answers_reach_the_model(self):
        self.assertIsNone(screening(answers()))
        for key, value in [("history", ["pregnant"]), ("history", ["medicines"]),
                           ("age", ["child"]), ("duration", ["longer"]),
                           ("severity", ["severe"]), ("urgent", ["unknown"])]:
            with self.subTest(key=key, value=value):
                self.assertIsNone(screening({**answers(), key: value}))
        self.assertEqual(screening({**answers(), "urgent": ["breathing"]}), "urgent")

    def test_moderate_sore_throat_reaches_model_screening(self):
        data = {"areas": ["throat"], "urgent": ["none"], "throat.feel": ["sore"],
                "duration": ["days"], "severity": ["moderate"], "age": ["adult"],
                "history": ["none"]}
        self.assertIsNone(screening(data))
        self.assertEqual(screening({**data, "urgent": ["breathing"]}), "urgent")

    def test_invalid_and_stale_answers_are_rejected(self):
        for change in [{"areas": ["invented"]}, {"urgent": []}, {"history": None},
                       {"urgent": ["none", "breathing"]}, {"head.feel": ["ache", "ache"]},
                       {"age": ["adult", "child"]}, {"history": ["allergy"]},
                       {"phone": ["private"]}, {"areas": ["chest"]}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_answers({**answers(), **change})

    def test_history_followups_required(self):
        data = {**answers(), "history": ["allergy", "condition"], "allergy.reaction": ["rash"], "conditions": ["heart"]}
        self.assertIsNone(screening(data))
        del data["conditions"]
        with self.assertRaises(ValueError):
            screening(data)

    def test_candidate_filter(self):
        rows = [product(), product(2, requires_prescription=True), product(3, stock_quantity=0),
                product(4, quantity_limit=0), product(5, active_ingredient=None)]
        self.assertEqual(candidates(rows), [rows[0]])

    @patch("apps.catalogue.services.guidance_services.build_opener")
    def test_provider_contract_and_privacy(self, opener):
        response = opener.return_value.open.return_value.__enter__.return_value
        response.read.return_value = json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": '{"product_id":1}'}}]}).encode()
        self.assertEqual(select_with_groq(answers(), [product()], api_key="test-key", model="test-model"), 1)
        request = opener.return_value.open.call_args.args[0]
        payload = json.loads(request.data)
        self.assertTrue(payload["response_format"]["json_schema"]["strict"])
        self.assertNotIn("test-key", request.data.decode())
        sent = json.loads(payload["messages"][1]["content"])
        self.assertEqual(set(sent), {"answers", "catalogue"})
        self.assertNotIn("price", sent["catalogue"][0])
        for bad in ['{"product_id":999}', '{"product_id":true}', '{"product_id":1,"dose":"unsafe"}', 'not JSON']:
            response.read.return_value = json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": bad}}]}).encode()
            with self.subTest(bad=bad), self.assertRaises(GuidanceUnavailable):
                select_with_groq(answers(), [product()], api_key="test-key", model="test-model")
        response.read.return_value = b"x" * 65537
        with self.assertRaises(GuidanceUnavailable):
            select_with_groq(answers(), [product()], api_key="test-key", model="test-model")
        opener.return_value.open.side_effect = TimeoutError()
        with self.assertRaises(GuidanceUnavailable):
            select_with_groq(answers(), [product()], api_key="test-key", model="test-model")

    def test_missing_key_does_not_make_request(self):
        with patch("apps.catalogue.services.guidance_services.build_opener") as opener:
            with self.assertRaises(GuidanceUnavailable):
                select_with_groq(answers(), [product()], api_key="", model="test-model")
            opener.assert_not_called()

    def test_partial_answers_and_question_prerequisites(self):
        self.assertEqual([q['id'] for q in next_question_candidates({'areas': ['head']})], ['head.feel'])
        choices = next_question_candidates({'areas': ['head'], 'head.feel': ['ache']})
        self.assertNotIn('urgent', [q['id'] for q in choices])
        self.assertEqual(next_question_candidates(answers()), [])
        changed = {**answers(), 'head.feel': ['fever']}
        changed['urgent'] = ['stiff']
        self.assertEqual(screening(changed), 'urgent')
        changed['head.feel'] = ['ache']
        with self.assertRaises(ValueError):
            validate_answers(changed)

    def test_catalogue_paths_use_ingredients_forms_stock_and_rx(self):
        self.assertEqual(candidates([product()], 'head'), [product()])
        self.assertEqual(candidates([product()], 'stomach'), [])
        self.assertEqual(candidates([product(active_ingredient='Sodium chloride', dosage_form='Eye drops')], 'nose'), [])
        self.assertEqual(candidates([product()], 'unknown'), [])

    @patch('apps.catalogue.services.guidance_services._groq_json')
    def test_ai_next_question_cannot_repeat_skip_or_invent_questions(self, call):
        call.return_value = {'question_id': 'head.feel'}
        self.assertEqual(next_with_groq({'areas': ['head']}, [product()], api_key='test', model='test'), 'head.feel')
        for invalid in ['areas', 'urgent', 'invented', None]:
            call.return_value = {'question_id': invalid}
            with self.subTest(invalid=invalid), self.assertRaises(GuidanceUnavailable):
                next_with_groq({'areas': ['head']}, [product()], api_key='test', model='test')
        call.return_value = {'question_id': None}
        self.assertIsNone(next_with_groq(answers(), [product()], api_key='test', model='test'))
