import type { RegistrationDocumentKind } from '@have/shared/api/advisor';

export const registrationFields = ['first_name', 'last_name', 'name_ar', 'clinic_name', 'clinic_name_ar', 'clinic_address', 'clinic_address_ar', 'nationality', 'country_of_graduation', 'medical_school'] as const;

export function requiredDocuments(nationality: string): RegistrationDocumentKind[] {
  return ['graduation', ...(nationality === 'EG' ? ['id_front', 'id_back'] as const : ['passport'] as const), 'syndicate'];
}

export function validateDocument(file: Pick<File, 'type' | 'size'>): 'imageType' | 'imageSize' | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'imageType';
  if (!file.size || file.size > 10 * 1024 * 1024) return 'imageSize';
  return null;
}

// ISO country codes are identifiers, not an institution or qualification directory.
const codes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');

export function countryOptions(language: string) {
  const names = new Intl.DisplayNames([language], { type: 'region' });
  return codes.map(code => ({ code, label: names.of(code) || code })).sort((a, b) => a.label.localeCompare(b.label, language));
}
