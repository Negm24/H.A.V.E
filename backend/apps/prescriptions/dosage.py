"""Doctor-authored dosage records; no clinical dosing recommendations."""
from decimal import Decimal
from rest_framework import serializers
from apps.accounts.api.serializers.shared_serializers import StrictInputSerializer


def dose_unit(form):
    form = (form or '').strip().lower()
    mapping = {
        'tablets':'tablet', 'film-coated tablets':'tablet', 'sugar-coated tablets':'tablet',
        'gastro-resistant tablets':'tablet', 'caplets':'tablet', 'capsules':'capsule',
        'gastro-resistant capsules':'capsule', 'prolonged-release capsules':'capsule',
        'nasal drops':'drop', 'oral drops':'drop', 'eye drops':'drop', 'ear drops':'drop',
        'oral suspension':'mL', 'oral solution':'mL', 'syrup':'mL', 'nasal spray':'spray',
        'topical cream':'application', 'cream':'application', 'ointment':'application',
        'topical gel':'application', 'effervescent granules':'sachet',
    }
    return mapping.get(form)



class DosageInput(StrictInputSerializer):
    mode = serializers.ChoiceField(choices=['structured', 'custom', 'none'])
    catalogue_form = serializers.CharField(max_length=200, required=False)
    amount = serializers.DecimalField(max_digits=9, decimal_places=3, min_value=Decimal('0.001'), required=False)
    schedule = serializers.ChoiceField(choices=['times', 'interval', 'daily', 'meals', 'once', 'prn'], required=False)
    times = serializers.ListField(child=serializers.RegexField(r'^([01][0-9]|2[0-3]):[0-5][0-9]$'), max_length=24, required=False)
    hours = serializers.IntegerField(min_value=1, max_value=10000, required=False)
    daily_count = serializers.IntegerField(min_value=1, max_value=100, required=False)
    meals = serializers.ListField(child=serializers.ChoiceField(choices=['breakfast', 'lunch', 'dinner']), max_length=3, required=False)
    food = serializers.ChoiceField(choices=['unspecified', 'before', 'with', 'after'], default='unspecified')
    duration = serializers.ChoiceField(choices=['days', 'weeks', 'until', 'ongoing'], required=False)
    duration_count = serializers.IntegerField(min_value=1, max_value=10000, required=False)
    until = serializers.DateField(required=False)
    first_time = serializers.RegexField(r'^([01][0-9]|2[0-3]):[0-5][0-9]$', required=False, allow_blank=True)
    once_at = serializers.DateTimeField(required=False)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)
    max_doses = serializers.IntegerField(min_value=1, max_value=100, required=False)
    notes = serializers.CharField(max_length=2000, required=False, allow_blank=True, trim_whitespace=False)

    def validate(self, data):
        if data['mode'] != 'structured':
            if any(k not in ('mode', 'food', 'notes') for k in data):
                raise serializers.ValidationError('Non-structured instructions cannot contain a dosing schedule.')
            return {'mode': data['mode']}
        required = ['amount', 'schedule']
        schedule = data.get('schedule')
        required += {'times':['times'], 'interval':['hours'], 'daily':['daily_count'],
                     'meals':['meals'], 'prn':['hours','reason','max_doses']}.get(schedule, [])
        if schedule != 'once':
            required += ['duration']
            if data.get('duration') in ('days','weeks'): required += ['duration_count']
            if data.get('duration') == 'until': required += ['until']
        if any(not data.get(k) for k in required):
            raise serializers.ValidationError('Complete the dose, schedule and treatment duration.')
        if schedule == 'meals' and data['food'] == 'unspecified':
            raise serializers.ValidationError('Choose before, with or after the selected meals.')
        allowed = {'catalogue_form','mode','amount','schedule','food','notes'}
        allowed |= {'times':{'times'},'interval':{'hours','first_time'},'daily':{'daily_count'},
                    'meals':{'meals'},'once':{'once_at'},'prn':{'hours','reason','max_doses'}}.get(schedule,set())
        if schedule != 'once':
            allowed.add('duration')
            allowed |= {'days':{'duration_count'},'weeks':{'duration_count'},'until':{'until'}}.get(data.get('duration'),set())
        if set(data) - allowed:
            raise serializers.ValidationError('Remove fields that contradict the selected schedule.')
        for key in ('times','meals'):
            if key in data and len(data[key]) != len(set(data[key])):
                raise serializers.ValidationError('Repeated times or meals are not allowed.')
        if data.get('until'):
            from django.utils import timezone
            from zoneinfo import ZoneInfo
            if data['until'] < timezone.localdate(timezone=ZoneInfo('Africa/Cairo')):
                raise serializers.ValidationError('Treatment end date cannot be in the past.')
        return {k: str(v) if isinstance(v, Decimal) or hasattr(v, 'isoformat') else v for k,v in data.items()}


def render_dosage(data, unit, language='en'):
    ar = language == 'ar'
    if data['mode'] == 'none': return 'لم تُسجل تعليمات.' if ar else 'No instructions recorded.'
    amount = str(data['amount']).rstrip('0').rstrip('.') if '.' in str(data['amount']) else str(data['amount'])
    units = {'tablet':'قرص','capsule':'كبسولة','drop':'قطرة','mL':'مل','application':'مرة تطبيق','spray':'بخة','sachet':'كيس'}
    parts = [f"الكمية لكل جرعة: {amount} {units[unit]}." if ar else f"Amount per dose: {amount} {unit}."]
    schedule = data['schedule']
    if schedule == 'times': parts.append(('يومياً في: ' if ar else 'Daily at: ') + ', '.join(data['times']) + ' (Africa/Cairo).')
    if schedule == 'interval':
        parts.append(f"كل {data['hours']} ساعة." if ar else f"Every {data['hours']} hours.")
        if data.get('first_time'): parts.append(('وقت الجرعة الأولى: ' if ar else 'First dose time: ') + data['first_time'] + ' (Africa/Cairo).')
    if schedule == 'daily': parts.append(f"{data['daily_count']} مرات يومياً." if ar else f"{data['daily_count']} times daily.")
    if schedule == 'once':
        parts.append('مرة واحدة فقط.' if ar else 'Once only.')
        if data.get('once_at'): parts.append(('موعد الجرعة: ' if ar else 'Dose date/time: ') + data['once_at'])
    food = data.get('food','unspecified')
    if schedule == 'meals':
        meals = {'breakfast':'الإفطار','lunch':'الغداء','dinner':'العشاء'}
        relation = {'before':'قبل','with':'مع','after':'بعد'}
        parts.append((relation[food] + ' ' + '، '.join(meals[m] for m in data['meals']) + '.') if ar else food.capitalize() + ' ' + ', '.join(data['meals']) + '.')
    elif food != 'unspecified':
        parts.append({'before':'قبل الطعام.','with':'مع الطعام.','after':'بعد الطعام.'}[food] if ar else food.capitalize() + ' food.')
    if schedule == 'prn':
        parts.append(f"عند الحاجة: {data['reason']}. فاصل أدنى {data['hours']} ساعة؛ بحد أقصى {data['max_doses']} جرعة خلال 24 ساعة." if ar else f"As needed: {data['reason']}. Minimum interval {data['hours']} hours; maximum {data['max_doses']} doses in 24 hours.")
    duration = data.get('duration')
    if duration in ('days','weeks'): parts.append(f"المدة: {data['duration_count']} {'أيام' if duration == 'days' else 'أسابيع'}." if ar else f"For {data['duration_count']} {duration}.")
    if duration == 'until': parts.append(('حتى ' if ar else 'Until ') + data['until'] + '.')
    if duration == 'ongoing': parts.append('مستمر حتى المراجعة.' if ar else 'Ongoing until reviewed.')
    if data.get('notes'): parts.append(data['notes'])
    return '\n'.join(parts)
