/**
 * Claude Matching Service
 *
 * Sends candidate items and a reference entity to the Anthropic Messages API
 * and returns a structured match decision.
 */

import { Logger as ILogger } from 'n8n-workflow';

// ── Types ──────────────────────────────────────────────────────────────────

export interface IClaudeMatchCandidate {
	/** Position in the list (0-indexed) */
	index: number;
	/** Structured field extractions (from matcher criteria selectors) */
	fields: Record<string, string>;
	/** Full cleaned text content of the candidate DOM element */
	fullText: string;
}

/** Field comparison metadata passed from matcher configuration */
export interface IClaudeFieldMeta {
	/** Field name (e.g. "Name", "Location") */
	name: string;
	/** Importance weight (0-1). Higher = more important for matching */
	weight: number;
	/** Minimum similarity threshold (0-1) for this field */
	threshold: number;
	/** If true, this field MUST match for the candidate to be considered */
	mustMatch: boolean;
}

export interface IClaudeMatchConfig {
	apiKey: string;
	model: string;
	/** The reference entity to match against (field name → value) */
	referenceEntity: Record<string, string>;
	/** All candidate items extracted from the page */
	candidates: IClaudeMatchCandidate[];
	/** Optional domain-specific context from the user */
	matchContext?: string;
	/** Field comparison metadata (weights, thresholds, mustMatch flags) */
	fieldMeta?: IClaudeFieldMeta[];
	logger?: ILogger;
}

export interface IClaudeMatchResult {
	/** Index of the matched candidate, or null if no match */
	matchIndex: number | null;
	/** Whether Claude determined this is a match (true) or not (false) */
	isMatch: boolean;
	/** Backward-compatible confidence: 1.0 if matched, 0.0 if not */
	confidence: number;
	/** Human-readable explanation */
	reasoning: string;
	/** Groups of candidate indices that appear to be the same person */
	duplicates: number[][];
	/** Notable observations (near-miss addresses, data quality notes) */
	flags: string[];
	/** Model used */
	model: string;
	/** Tokens consumed */
	usage: { input: number; output: number };
}

// ── Constants ──────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

// ── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an entity-matching evaluator. You receive a REFERENCE ENTITY, a list of CANDIDATES, and metadata about which fields matter most.

FIELD METADATA:
Each reference field has a weight (0-1) indicating its importance to the match. Fields marked "MUST MATCH" are hard requirements — if a must-match field clearly contradicts, reject the candidate. Weights tell you how much each field should influence your decision: a field with weight 0.7 matters much more than one with weight 0.3.

HOW TO EVALUATE:
- Start with the highest-weighted fields. A strong match on a high-weight field (like an exact name match) is a strong signal even if lower-weight fields diverge.
- Partial matches count. Nicknames, abbreviations, maiden names, name variations, and slight misspellings are common and should be treated as likely matches, not disqualifications.
- For names: same last name + same or similar first name + matching geographic area = strong match. Middle initials help distinguish family members (father/son often share a first and last name but differ on middle initial).
- For addresses: the reference address may be a former address (not necessarily where the person lives now). If a candidate lists the reference address among their known locations, that is a STRONG positive signal. But a non-matching address alone does NOT disqualify a candidate.
- When only one candidate is present and the name matches well, apply a lower bar — the prior probability of a match is higher with fewer candidates.
- When multiple candidates appear to be the same person (duplicates), prefer the one with the richest data (most addresses, most detail, most recent information).

WHAT NOT TO DO:
- Do not require every field to match. Use the weights.
- Do not reject a candidate solely because an address doesn't match — people move.
- Do not reject based on missing data. A blank field is neutral, not negative.

RESPONSE FORMAT:
Your entire response must be a single JSON object. Nothing else.
No introduction. No explanation. No conclusion. No markdown. No backticks. No text before or after the JSON.
The first character of your response must be { and the last must be }.

{
  "isMatch": true/false,
  "matchIndex": <0-indexed number or null>,
  "reasoning": "<brief explanation>",
  "duplicates": [[<indices of same entity>], ...],
  "flags": ["<notable observation>", ...]
}`;

// ── Main Function ──────────────────────────────────────────────────────────

export async function invokeClaudeMatching(
	config: IClaudeMatchConfig,
): Promise<IClaudeMatchResult> {
	const { apiKey, model, referenceEntity, candidates, matchContext, fieldMeta, logger } = config;

	// Build the user prompt
	const userPrompt = buildUserPrompt(referenceEntity, candidates, matchContext, fieldMeta);

	logger?.info(`[ClaudeMatch] Sending ${candidates.length} candidates to ${model}`);
	logger?.info(`[ClaudeMatch] Reference entity: ${JSON.stringify(referenceEntity)}`);

	// Call the Anthropic API
	const response = await fetch(ANTHROPIC_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': ANTHROPIC_VERSION,
		},
		body: JSON.stringify({
			model,
			max_tokens: MAX_TOKENS,
			system: SYSTEM_PROMPT,
			messages: [
				{ role: 'user', content: userPrompt },
			],
		}),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
	}

	const data = await response.json() as any;

	// Extract the text response
	const textBlock = data.content?.find((block: any) => block.type === 'text');
	if (!textBlock?.text) {
		throw new Error('Anthropic API returned no text content');
	}

	// Parse the JSON response
	let parsed: any;
	try {
		// Strip markdown code fences if present
		let jsonText = textBlock.text.trim();
		if (jsonText.startsWith('```')) {
			jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
		}
		parsed = JSON.parse(jsonText);
	} catch (parseError) {
		// Claude sometimes wraps JSON in prose — try to extract the JSON object
		const jsonMatch = textBlock.text.match(/\{[\s\S]*"isMatch"[\s\S]*\}/);
		if (jsonMatch) {
			try {
				parsed = JSON.parse(jsonMatch[0]);
				logger?.warn(`[ClaudeMatch] Extracted JSON from prose response`);
			} catch {
				logger?.error(`[ClaudeMatch] Failed to parse response: ${textBlock.text.substring(0, 500)}`);
				throw new Error(`Failed to parse Claude response as JSON: ${(parseError as Error).message}`);
			}
		} else {
			logger?.error(`[ClaudeMatch] Failed to parse response: ${textBlock.text.substring(0, 500)}`);
			throw new Error(`Failed to parse Claude response as JSON: ${(parseError as Error).message}`);
		}
	}

	// Determine boolean match from response
	const isMatch = parsed.isMatch === true || (parsed.matchIndex !== null && parsed.matchIndex !== undefined);
	const matchIndex = isMatch ? (parsed.matchIndex ?? null) : null;

	const result: IClaudeMatchResult = {
		matchIndex,
		isMatch,
		confidence: isMatch ? 1.0 : 0.0, // backward-compatible: derive from boolean
		reasoning: parsed.reasoning || '',
		duplicates: Array.isArray(parsed.duplicates) ? parsed.duplicates : [],
		flags: Array.isArray(parsed.flags) ? parsed.flags : [],
		model,
		usage: {
			input: data.usage?.input_tokens || 0,
			output: data.usage?.output_tokens || 0,
		},
	};

	logger?.info(`[ClaudeMatch] Result: isMatch=${result.isMatch}, matchIndex=${result.matchIndex}`);
	logger?.info(`[ClaudeMatch] Reasoning: ${result.reasoning}`);
	logger?.info(`[ClaudeMatch] Tokens: ${result.usage.input} in / ${result.usage.output} out`);

	return result;
}

// ── Prompt Builder ─────────────────────────────────────────────────────────

function buildUserPrompt(
	referenceEntity: Record<string, string>,
	candidates: IClaudeMatchCandidate[],
	matchContext?: string,
	fieldMeta?: IClaudeFieldMeta[],
): string {
	const lines: string[] = [];

	// Build a lookup of field metadata by name (case-insensitive)
	const metaByName = new Map<string, IClaudeFieldMeta>();
	if (fieldMeta && fieldMeta.length > 0) {
		for (const fm of fieldMeta) {
			metaByName.set(fm.name.toLowerCase(), fm);
		}
	}

	// Reference entity with field importance metadata
	lines.push('REFERENCE ENTITY (the target to match):');
	for (const [key, value] of Object.entries(referenceEntity)) {
		if (value && value.trim()) {
			const meta = metaByName.get(key.toLowerCase());
			if (meta) {
				const parts: string[] = [`weight: ${meta.weight}`];
				if (meta.mustMatch) parts.push('MUST MATCH');
				lines.push(`  ${key}: ${value.trim()}  [${parts.join(', ')}]`);
			} else {
				lines.push(`  ${key}: ${value.trim()}`);
			}
		}
	}

	// Summary of field importance if metadata is available
	if (metaByName.size > 0) {
		lines.push('');
		lines.push('FIELD IMPORTANCE SUMMARY:');
		const sorted = [...metaByName.values()].sort((a, b) => b.weight - a.weight);
		for (const fm of sorted) {
			const label = fm.mustMatch ? ' (MUST MATCH)' : '';
			lines.push(`  ${fm.name}: weight ${fm.weight}${label}`);
		}
	}
	lines.push('');

	// Candidates
	lines.push(`CANDIDATES (${candidates.length} items extracted from page):`);
	for (const candidate of candidates) {
		lines.push(`[${candidate.index}] ---`);

		// Structured fields first
		if (Object.keys(candidate.fields).length > 0) {
			for (const [field, value] of Object.entries(candidate.fields)) {
				if (value && value.trim()) {
					lines.push(`  ${field}: ${value.replace(/\s+/g, ' ').trim()}`);
				}
			}
		}

		// Full text content (provides additional context beyond the configured fields)
		if (candidate.fullText && candidate.fullText.trim()) {
			const cleanedText = candidate.fullText.trim()
				.replace(/\s+/g, ' ');      // collapse whitespace
			lines.push(`  [Full Text]: ${cleanedText}`);
		}
		lines.push('');
	}

	// Optional domain context
	if (matchContext && matchContext.trim()) {
		lines.push('ADDITIONAL CONTEXT:');
		lines.push(matchContext.trim());
		lines.push('');
	}

	lines.push('Which candidate best matches the reference entity? Are any candidates duplicates of each other?');

	return lines.join('\n');
}

// ── Model List ─────────────────────────────────────────────────────────────

/**
 * Fetches available Claude models from the Anthropic API.
 * Falls back to a static list if the API call fails.
 */
export async function fetchAvailableModels(
	apiKey: string,
	logger?: ILogger,
): Promise<Array<{ id: string; displayName: string }>> {
	try {
		const response = await fetch('https://api.anthropic.com/v1/models?limit=100', {
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': ANTHROPIC_VERSION,
			},
		});

		if (!response.ok) {
			throw new Error(`API returned ${response.status}`);
		}

		const data = await response.json() as any;
		const models: Array<{ id: string; displayName: string }> = [];

		if (data.data && Array.isArray(data.data)) {
			for (const model of data.data) {
				// Only include chat models (skip embedding, etc.)
				if (model.id && model.display_name) {
					models.push({
						id: model.id,
						displayName: model.display_name,
					});
				}
			}
		}

		if (models.length > 0) {
			logger?.info(`[ClaudeMatch] Fetched ${models.length} models from Anthropic API`);
			return models;
		}
	} catch (error) {
		logger?.warn(`[ClaudeMatch] Failed to fetch models from API: ${(error as Error).message}. Using static list.`);
	}

	// Fallback static list
	return getStaticModelList();
}

/** Static fallback model list — update when new models are released */
export function getStaticModelList(): Array<{ id: string; displayName: string }> {
	return [
		{ id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4' },
		{ id: 'claude-sonnet-4-5-20250514', displayName: 'Claude Sonnet 4.5' },
		{ id: 'claude-haiku-3-5-20241022', displayName: 'Claude Haiku 3.5' },
	];
}
