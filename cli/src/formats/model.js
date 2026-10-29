// Shared JSDoc types for local texts read from app files.

/**
 * One text of one locale.
 * @typedef {object} LocalEntry
 * @property {string} value plain text, or the `other` form for plurals, or a JSON array for string arrays
 * @property {'translated' | 'draft'} status
 * @property {Record<string, string>} [forms] plural forms by CLDR category
 * @property {number} [selector] plural argument number, when the file states it
 * @property {string[]} [items] string-array items (Android)
 */

/**
 * Everything a target's files contain.
 * @typedef {object} LocalTexts
 * @property {string} [sourceLanguage] source language declared by the file (xcstrings)
 * @property {Record<string, Record<string, LocalEntry>>} locales locale → key → entry
 * @property {Record<string, string>} comments key → translator context
 * @property {string[]} keys every key the files define, including ones without values
 * @property {string[]} warnings
 * @property {Record<string, 'string' | 'plurals' | 'array'>} [kinds]
 * @property {Record<string, number>} [pluralArguments]
 */

export {};
