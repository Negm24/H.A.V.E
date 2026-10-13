// Numeric text stays text: PINs, codes and phone numbers can start with zero.
export function latinDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, char => String('٠١٢٣٤٥٦٧٨٩'.includes(char)
    ? '٠١٢٣٤٥٦٧٨٩'.indexOf(char) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
}
