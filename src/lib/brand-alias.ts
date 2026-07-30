export function normalizeBrandAlias(value: string) {
	const unicode = value.normalize('NFC').toLowerCase().trim();
	const latinFolded = unicode.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');

	// Preserve legacy keys for Latin and mixed-script aliases.
	if (/[a-z]/.test(latinFolded)) return latinFolded.replace(/[^a-z0-9]/g, '');

	return unicode.replace(/[^\p{L}\p{N}]/gu, '');
}
