import json
import unittest
from unittest.mock import patch
from apps.catalogue.services.guidance_services import (
    screening, validate_answers, candidates, select_with_groq, GuidanceUnavailable,
)


def answers():
    return {"areas": ["head"], "urgent": ["none"], "head.location": ["front"],
            "head.feel": ["ache"], "duration": ["today"], "severity": ["mild"],
            "age": ["adult"], "history": ["none"]}


def product(id=1, **overrides):
    return {"id": id, "requires_prescription": False, "stock_quantity": 4,
            "quantity_limit": 4, "active_ingredient": "Example", "strength": "Example", **overrides}


class GuidanceTests(unittest.TestCase):
    def test_non_emergency_demo_answers_reach_the_model(self):
        self.assertIsNone(screening(answers()))
        for key, value in [("history", ["pregnant"]), ("history", ["medicines"]),
                           ("age", ["child"]), ("duration", ["longer"]),
                           ("severity", ["severe"]), ("urgent", ["unknown"])]:
            with self.subTest(key=key, value=value):
                self.assertIsNone(screening({**answers(), key: value}))
        self.assertEqual(screening({**answers(), "urgent": ["breathing"]}), "urgent")

    def test_moderate_dry_cough_reaches_model_screening(self):
        data = {"areas": ["throat"], "urgent": ["none"], "throat.feel": ["dry"],
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
