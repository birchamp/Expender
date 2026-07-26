const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Monotonic, collision-resistant id. The time prefix keeps rows roughly
 * insertion-ordered, which makes SQLite index locality (and debugging) nicer.
 */
export function newId(prefix = ''): string {
  const time = Date.now().toString(36).padStart(9, '0');
  let rand = '';
  for (let i = 0; i < 10; i++) {
    rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}${time}${rand}`;
}
