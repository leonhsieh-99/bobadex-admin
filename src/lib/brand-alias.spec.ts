import { describe, expect, it } from 'vitest';
import { normalizeBrandAlias } from './brand-alias';

describe('normalizeBrandAlias', () => {
	it.each([
		['春水堂', '春水堂'],
		['春水堂2號', '春水堂2號'],
		['貢茶', '貢茶'],
		['贡茶', '贡茶'],
		['공차', '공차'],
		['ゴンチャ', 'ゴンチャ']
	])('preserves non-Latin alias letters and numbers in %s', (input, expected) => {
		expect(normalizeBrandAlias(input)).toBe(expected);
	});

	it.each([
		['Chun Shui Tang', 'chunshuitang'],
		['春水堂 Chun Shui Tang', 'chunshuitang'],
		['Déjà Vu', 'dejavu'],
		['Devil|Angel', 'devilangel']
	])('preserves legacy Latin normalization for %s', (input, expected) => {
		expect(normalizeBrandAlias(input)).toBe(expected);
	});

	it('rejects aliases without letters or numbers', () => {
		expect(normalizeBrandAlias('---')).toBe('');
	});
});
