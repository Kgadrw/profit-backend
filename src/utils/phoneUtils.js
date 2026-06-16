/** Normalize Rwanda phone numbers to 0XXXXXXXXX (10 digits). */
export function normalizeAccountPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('250') && digits.length >= 12) {
    return `0${digits.slice(3, 12)}`;
  }
  if (digits.length === 9) {
    return `0${digits}`;
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    return digits.slice(0, 10);
  }
  return digits.slice(0, 15);
}

export function isValidAccountPhone(phone) {
  return /^0\d{9}$/.test(normalizeAccountPhone(phone));
}
