export const PASSWORD_MIN_LENGTH = 8;

export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH;
}

export function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(value);
}
