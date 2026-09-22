export function extractApiErrorMessage(error: unknown, fallback: string): string {
  const response = (error as { error?: unknown } | null)?.error;

  if (typeof response === 'string' && response.trim()) {
    return response.trim();
  }

  if (response && typeof response === 'object') {
    const body = response as {
      message?: unknown;
      title?: unknown;
      error?: unknown;
      errors?: Record<string, unknown>;
    };

    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message.trim();
    }

    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error.trim();
    }

    if (body.errors) {
      for (const value of Object.values(body.errors)) {
        const message = Array.isArray(value) ? value.find((item) => typeof item === 'string') : value;
        if (typeof message === 'string' && message.trim()) {
          return message.trim();
        }
      }
    }

    if (typeof body.title === 'string' && body.title.trim()) {
      return body.title.trim();
    }
  }

  return fallback;
}
