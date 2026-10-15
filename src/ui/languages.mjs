// Answer languages Sharh names in its interface. Any other BCP 47 code can still be typed in Settings.
export const LANGUAGES = Object.freeze([['en', 'English'], ['uz', 'Oʻzbekcha (Latin)'], ['uz-Cyrl', 'Ўзбекча (Кирилл)'], ['ru', 'Русский'], ['ar', 'العربية'], ['fa', 'فارسی'], ['tr', 'Türkçe'], ['kk', 'Қазақша'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'], ['zh', '中文'], ['ja', '日本語'], ['hi', 'हिन्दी']]);
export function languageName(code) {
  return LANGUAGES.find(([value]) => value === code)?.[1] ?? code;
}
