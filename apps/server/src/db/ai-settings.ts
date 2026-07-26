import { pool } from './pool.js';

// Per-user persona/character configuration for the built-in AI assistant.
export type AiSettingsRecord = {
  user_id: string;
  assistant_name: string;
  assistant_avatar_data: string;
  assistant_avatar_history: string[];
  gender: string;
  persona: string;
  tone: string;
  response_length: string;
  emoji_usage: string;
  address_name: string;
  custom_instructions: string;
  onboarded: boolean;
  created_at: Date;
  updated_at: Date;
};

export const DEFAULT_AI_SETTINGS: Omit<AiSettingsRecord, 'user_id' | 'created_at' | 'updated_at'> = {
  assistant_name: 'NotAI',
  assistant_avatar_data: '',
  assistant_avatar_history: [],
  gender: 'neutral',
  persona: 'friendly',
  tone: 'balanced',
  response_length: 'balanced',
  emoji_usage: 'some',
  address_name: '',
  custom_instructions: '',
  onboarded: false
};

// Returns the user's saved settings, or sensible defaults when none exist yet.
export async function getAiSettings(userId: string): Promise<AiSettingsRecord> {
  const result = await pool.query<AiSettingsRecord>('SELECT * FROM ai_settings WHERE user_id = $1', [userId]);
  const existing = result.rows[0];
  if (existing) return existing;
  const now = new Date();
  return { user_id: userId, ...DEFAULT_AI_SETTINGS, created_at: now, updated_at: now };
}

export type AiSettingsInput = {
  assistantName?: string;
  assistantAvatarData?: string;
  assistantAvatarHistory?: string[];
  gender?: string;
  persona?: string;
  tone?: string;
  responseLength?: string;
  emojiUsage?: string;
  addressName?: string;
  customInstructions?: string;
  onboarded?: boolean;
};

// Upserts persona settings. Only provided fields are changed (COALESCE keeps
// the rest), and onboarded can be flipped to TRUE once the first-run setup is
// completed.
export async function upsertAiSettings(userId: string, input: AiSettingsInput): Promise<AiSettingsRecord> {
  const result = await pool.query<AiSettingsRecord>(
    `
      INSERT INTO ai_settings (
        user_id, assistant_name, assistant_avatar_data, assistant_avatar_history, gender, persona, tone,
        response_length, emoji_usage, address_name, custom_instructions, onboarded
      )
      VALUES (
        $1,
        COALESCE($2, $13), COALESCE($3, $14), COALESCE($4::jsonb, $15::jsonb), COALESCE($5, $16), COALESCE($6, $17), COALESCE($7, $18),
        COALESCE($8, $19), COALESCE($9, $20), COALESCE($10, $21), COALESCE($11, $22), COALESCE($12, FALSE)
      )
      ON CONFLICT (user_id) DO UPDATE SET
        assistant_name = COALESCE($2, ai_settings.assistant_name),
        assistant_avatar_data = COALESCE($3, ai_settings.assistant_avatar_data),
        assistant_avatar_history = COALESCE($4::jsonb, ai_settings.assistant_avatar_history),
        gender = COALESCE($5, ai_settings.gender),
        persona = COALESCE($6, ai_settings.persona),
        tone = COALESCE($7, ai_settings.tone),
        response_length = COALESCE($8, ai_settings.response_length),
        emoji_usage = COALESCE($9, ai_settings.emoji_usage),
        address_name = COALESCE($10, ai_settings.address_name),
        custom_instructions = COALESCE($11, ai_settings.custom_instructions),
        onboarded = COALESCE($12, ai_settings.onboarded),
        updated_at = NOW()
      RETURNING *
    `,
    [
      userId,
      input.assistantName,
      input.assistantAvatarData,
      input.assistantAvatarHistory ? JSON.stringify(input.assistantAvatarHistory) : undefined,
      input.gender,
      input.persona,
      input.tone,
      input.responseLength,
      input.emojiUsage,
      input.addressName,
      input.customInstructions,
      input.onboarded,
      DEFAULT_AI_SETTINGS.assistant_name,
      DEFAULT_AI_SETTINGS.assistant_avatar_data,
      JSON.stringify(DEFAULT_AI_SETTINGS.assistant_avatar_history),
      DEFAULT_AI_SETTINGS.gender,
      DEFAULT_AI_SETTINGS.persona,
      DEFAULT_AI_SETTINGS.tone,
      DEFAULT_AI_SETTINGS.response_length,
      DEFAULT_AI_SETTINGS.emoji_usage,
      DEFAULT_AI_SETTINGS.address_name,
      DEFAULT_AI_SETTINGS.custom_instructions
    ]
  );
  return result.rows[0];
}
