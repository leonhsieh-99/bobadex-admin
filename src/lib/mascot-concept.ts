export function conceptField(concept: Record<string, unknown> | null | undefined, key: string) {
	const value = concept?.[key];
	if (typeof value === 'string') return value.trim();
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string' && item.trim()).join(', ');
	}
	return '';
}

export function conceptSummary(concept: Record<string, unknown> | null | undefined) {
	return (
		conceptField(concept, 'subject') ||
		[conceptField(concept, 'ancestry_family'), conceptField(concept, 'body_plan')]
			.filter(Boolean)
			.join(' · ')
	);
}

export function conceptDirection(concept: Record<string, unknown> | null | undefined) {
	const current = [
		conceptField(concept, 'primary_motif'),
		conceptField(concept, 'pose'),
		conceptField(concept, 'expression'),
		conceptField(concept, 'accessory')
	]
		.filter(Boolean)
		.join(' · ');
	if (current) return current;
	return [
		conceptField(concept, 'dominant_feature'),
		conceptField(concept, 'secondary_marking'),
		conceptField(concept, 'temperament_pose')
	]
		.filter(Boolean)
		.join(' · ');
}

export function conceptPalette(concept: Record<string, unknown> | null | undefined) {
	return conceptField(concept, 'palette');
}
