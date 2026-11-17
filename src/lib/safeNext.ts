/** Only same-site paths are allowed as the page to land on after signing in.
 *  A browser reads "\\" as "/" and drops tabs and line breaks inside an address, so "/\\evil.com" or
 *  "/<tab>/evil.com" would leave the site just like "//evil.com": any backslash or control character is refused. */
export const safeNext = (next: string | null | undefined) =>
  (next && /^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/.test(next) ? next : "/dashboard");
