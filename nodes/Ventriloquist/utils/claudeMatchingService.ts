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

export interface IClaudeMatchConfig {
	apiKey: string;
	model: string;
	/** The reference entity to match against (field name → value) */
	referenceEntity: Record<string, string>;
	/** All candidate items extracted from the page */
	candidates: IClaudeMatchCandidate[];
	/** Optional domain-specific context from the user */
	matchContext?: string;
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

const SYSTEM_PROMPT = `You are evaluating which item from a list of candidates best matches a reference entity.

You will receive:
1. A REFERENCE ENTITY with known attributes (name, address, etc.)
2. A list of CANDIDATES with their extracted data
3. Optional CONTEXT about the domain/use case

Your job:
- Determine which candidate (if any) is the best match for the reference entity
- Consider ALL available information: names, addresses, ages, locations, counties, relationships, dates, and any other context clues
- Make a clear YES or NO decision — either a candidate matches or it does not
- Identify candidates that appear to be duplicates of each other
- Flag notable observations (near-miss data, data quality issues)
- If NO candidate is a good match, say so — do not force a match

You MUST respond with ONLY a JSON object (no markdown, no backticks):
{
  "isMatch": <true if a match was found, false if not>,
  "matchIndex": <number (0-indexed) or null if no good match>,
  "reasoning": "<brief explanation of your decision>",
  "duplicates": [[<indices that are the same entity>], ...],
  "flags": ["<notable observation>", ...]
}`;

// ── Main Function ──────────────────────────────────────────────────────────

export async function invokeClaudeMatching(
	config: IClaudeMatchConfig,
): Promise<IClaudeMatchResult> {
	const { apiKey, model, referenceEntity, candidates, matchContext, logger } = config;

	// Build the user prompt
	const userPrompt = buildUserPrompt(referenceEntity, candidates, matchContext);

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
		logger?.error(`[ClaudeMatch] Failed to parse response: ${textBlock.text}`);
		throw new Error(`Failed to parse Claude response as JSON: ${(parseError as Error).message}`);
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
): string {
	const lines: string[] = [];

	// Reference entity
	lines.push('REFERENCE ENTITY (the target to match):');
	for (const [key, value] of Object.entries(referenceEntity)) {
		if (value && value.trim()) {
			lines.push(`  ${key}: ${value.trim()}`);
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
					lines.push(`  ${field}: ${value.trim()}`);
				}
			}
		}

		// Full text content (provides additional context beyond the configured fields)
		if (candidate.fullText && candidate.fullText.trim()) {
			const cleanedText = candidate.fullText.trim()
				.replace(/\s+/g, ' ')      // collapse whitespace
				.substring(0, 1000);         // cap at 1000 chars per candidate
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
