export function normalizeCompanyName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
		.replace(/inc|llc|ltd|corp|corporation|company|co/g, '')
		.trim();
}

export function normalizeProductIdentifier(id: string): string {
	return id
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
		.trim();
}

export function calculateSimilarity(str1: string, str2: string): number {
	if (!str1 || !str2) return 0;
	if (str1 === str2) return 1;

	const s1 = str1.toLowerCase();
	const s2 = str2.toLowerCase();

	// Simple exact match after normalization
	if (s1 === s2) return 1;

	// Calculate Levenshtein distance
	const distance = levenshteinDistance(s1, s2);
	const maxLength = Math.max(s1.length, s2.length);

	// Convert distance to similarity score (0-1)
	return 1 - distance / maxLength;
}

function levenshteinDistance(s1: string, s2: string): number {
	const m = s1.length;
	const n = s2.length;
	const dp: number[][] = Array(m + 1)
		.fill(null)
		.map(() => Array(n + 1).fill(0));

	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (s1[i - 1] === s2[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1];
			} else {
				dp[i][j] = Math.min(
					dp[i - 1][j - 1] + 1, // substitution
					dp[i - 1][j] + 1,     // deletion
					dp[i][j - 1] + 1      // insertion
				);
			}
		}
	}

	return dp[m][n];
}
