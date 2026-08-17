export const CHAT_MESSAGE_MAX_CHARS = 4000;

export function chatMessageLengthError(length, max = CHAT_MESSAGE_MAX_CHARS) {
  const over = Math.max(0, Number(length) - max);
  return `Your message is too long (${Number(length).toLocaleString()} / ${max.toLocaleString()} characters). Remove about ${over.toLocaleString()} character${over === 1 ? '' : 's'} and try again.`;
}

export function assertChatBodyLength(trimmedBody) {
  const length = String(trimmedBody || '').length;
  if (length > CHAT_MESSAGE_MAX_CHARS) {
    const error = new Error(chatMessageLengthError(length));
    error.statusCode = 400;
    throw error;
  }
}

export function formatChatValidationError(error, bodyLength) {
  if (error?.name === 'ValidationError') {
    const bodyErr = error.errors?.body;
    if (
      bodyErr?.kind === 'maxlength' ||
      /longer than the maximum allowed length/i.test(String(error.message || ''))
    ) {
      return chatMessageLengthError(bodyLength || CHAT_MESSAGE_MAX_CHARS);
    }
  }
  return error?.message || 'Failed to send message';
}
