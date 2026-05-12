/*
 * Authently — Open-source AI content engine
 * Copyright (C) 2026 The Authently Contributors
 *
 * This file is part of Authently.
 *
 * Authently is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// packages/ai/transcription subpath exports.
//
// Consumer-facing surface: transcribeAudio + its public type
// contracts. Internal helpers (getOpenAIClient, __resetClientForTests
// from openai-client.ts) are NOT re-exported — they're accessible to
// the co-located test via relative import per Sprint 08 B0 Decision 3
// (test-only and internal helpers stay out of the package's public
// exports surface).

export { transcribeAudio } from "./openai-whisper.ts";
export type {
  TranscribeAudioInput,
  TranscribeAudioResult,
} from "./openai-whisper.ts";
