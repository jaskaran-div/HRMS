/** Logins are username + password. Supabase Auth wants an email, so a username maps to username@domain. */
export const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || 'derivion.in';

export const cleanUsername = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);

export const toEmail = (username: string) => `${cleanUsername(username)}@${LOGIN_DOMAIN}`;

/** jaskaran -> Jaskaran@isft */
export function defaultPassword(username: string): string {
  const u = cleanUsername(username);
  return u.charAt(0).toUpperCase() + u.slice(1) + '@isft';
}

/** Suggested username from a full name: first name, lowercase. */
export const suggestUsername = (fullName: string) => cleanUsername(fullName.trim().split(/\s+/)[0] ?? '');
