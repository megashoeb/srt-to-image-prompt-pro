import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { Subtitle } from "./srtParser";

// ============================================================
// AVAILABLE MODELS
// ============================================================
export const AVAILABLE_MODELS = [
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", tier: "fast", rpm: 15, description: "Fast & intelligent" },
  { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite", tier: "fast", rpm: 30, description: "Cheapest, high-volume" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", tier: "high", rpm: 5, description: "Best quality, slow" },
  { id: "gemma-4-26b-a4b-it", name: "Gemma 4 26B", tier: "fast", rpm: 15, description: "Open model, fast" },
  { id: "gemma-4-31b-it", name: "Gemma 4 31B", tier: "high", rpm: 15, description: "Open model, high quality" },
] as const;

export type ModelId = typeof AVAILABLE_MODELS[number]['id'];

// FIX 8: Fallback Order — quality-prioritized
const FALLBACK_ORDER: ModelId[] = [
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
];

function getFallbackModels(primaryModel: ModelId): ModelId[] {
  return FALLBACK_ORDER.filter(m => m !== primaryModel);
}

// ============================================================
// MODULE 1: PROMPT LENGTH CONTROLLER
// ============================================================
const PROMPT_CONFIG = {
  MIN_WORDS: 200,
  MAX_WORDS: 300,
  TARGET_WORDS: 250,
  // Token equivalents (1 word ≈ 1.35 tokens for English)
  TARGET_TOKENS: 340,
  JSON_OVERHEAD_TOKENS: 50,
} as const;

const PROMPT_LENGTH_INSTRUCTION = `
PROMPT LENGTH CONTROL (STRICTLY FOLLOW):
Each image prompt MUST be between ${PROMPT_CONFIG.MIN_WORDS}-${PROMPT_CONFIG.MAX_WORDS} words. Target: ${PROMPT_CONFIG.TARGET_WORDS} words.

STRUCTURE YOUR ${PROMPT_CONFIG.TARGET_WORDS} WORDS LIKE THIS:
- Scene setting + style opening:  ~40 words
- Main subject + action:          ~60 words
- Background + environment:       ~50 words
- Lighting + atmosphere:          ~40 words
- Historical details (weapons, uniforms, gear): ~40 words
- Style lock + technical specs:   ~20 words
TOTAL:                            ~${PROMPT_CONFIG.TARGET_WORDS} words

IF YOU EXCEED ${PROMPT_CONFIG.MAX_WORDS} WORDS → Cut redundant adjectives.
IF UNDER ${PROMPT_CONFIG.MIN_WORDS} WORDS → Add more environmental or historical detail.
`;

// ============================================================
// SHARED NANO BANANA OPTIMIZATION RULES (injected into all styles except Chalkboard)
// ============================================================
const NANO_BANANA_RULES = `
NANO BANANA PROMPT FORMULA (EVERY PROMPT MUST FOLLOW):
Write each prompt as ONE FLOWING NARRATIVE PARAGRAPH — NOT a keyword list.
Nano Banana responds best to descriptive scene direction.

Every prompt MUST contain these elements in this order:

1. SUBJECT + EXPRESSION: Character with physical description + facial expression + body language.
   - Read the subtitle context and INFER the correct emotional reaction.
   - "News of defeat" → anguish, clenched jaw, tears
   - "Victory celebration" → triumphant smile, arms raised, chest out
   - "Plotting/scheming" → narrowed eyes, leaning forward, fingers steepled
   - "Fear/dread" → wide eyes, pale face, trembling hands, hunched shoulders
   - "Calm authority" → steady gaze, upright posture, measured gesture
   - NEVER leave a character expressionless. Every person has a reaction.

2. ACTION: What is physically happening — body language, gesture, movement.
   - MUST be something a camera could photograph.
   - WRONG: "Embodying the spirit of the empire"
   - CORRECT: "Slamming a fist on the war table, sending clay markers scattering"

3. LOCATION/CONTEXT: Specific sub-area of location + 2-3 physical environmental details.
   - WRONG: "A palace"
   - CORRECT: "The torch-lit war council chamber of the palace, cracked stone walls hung with faded battle tapestries, a heavy oak table covered in parchment maps"

4. COMPOSITION + CAMERA/LENS: Shot type + focal length + aperture + depth of field.
   Select based on dramatic content — NEVER repeat same shot type more than 2 consecutive times:
   - Establishing/location → Ultra-wide, 16mm, deep DOF
   - Army/crowd/battle scale → Wide shot, 24mm, deep DOF
   - Character introduction/power → Low-angle hero shot, 24mm
   - Character speaking/thinking → Medium close-up, 50mm, moderate DOF
   - Emotional moment (grief/fear/pride) → Extreme close-up, 85mm, f/1.8 shallow DOF
   - Two characters interacting → Over-the-shoulder, 35mm
   - Divine/supernatural reveal → Low-angle 24mm, entity towering
   - Battle action → Dynamic low-angle 24mm, motion energy
   - Aftermath/death → High-angle bird's eye, looking down
   - Suspense/mystery → 50mm, extreme contrast, deep shadows

5. COLOR GRADING: Specific color tones matching scene mood (use color names, not hex codes).

6. EMOTIONAL LIGHTING: Match lighting to emotional content:
   - Fear/dread → Low-key harsh light, deep black shadows
   - Pride/power/triumph → Rim lighting from behind, golden warm glow
   - Sadness/loss → Overcast flat diffused, cold blue, no contrast
   - Anger/battle/chaos → Warm flickering fire-lit, high contrast, red-amber
   - Mystery/supernatural → Backlit silhouette, atmospheric fog, cold teal
   - Peace/wisdom → Soft diffused golden light from above
   - Loneliness → Single small light source in vast darkness
   - Awe/revelation → Volumetric god-rays breaking through darkness

7. MATERIALITY: ALWAYS describe specific materials and textures:
   - NEVER "armor" → "layered bronze cuirass with embossed motifs and leather pteruges"
   - NEVER "robe" → "heavy indigo-dyed linen with gold meander pattern at the hem"
   - NEVER "sword" → "leaf-bladed bronze xiphos with ivory grip wrapped in ox-leather"
   - NEVER "helmet" → "Corinthian bronze helmet with tall horsehair crest dyed crimson"
   - NEVER "dress" → "silk brocade gown with pearl-sewn bodice and velvet underskirt"
   - Include fabric textures, metal finishes, wood grains, stone surfaces.

8. STYLE LOCK + ASPECT RATIO: Locked visual style DNA + "16:9 aspect ratio" at the end.

SUBJECT VARIETY: NEVER repeat same subject more than 3 consecutive prompts.
Even if 15 subtitles talk about one character, VARY the visual:
- Show from DIFFERENT angles/distances
- Show character's EFFECTS on environment
- Show OBJECTS or PROPS in detail
- Show OTHER BEINGS reacting
- Show LANDSCAPE with character small in frame
- Show EXTREME CLOSE-UP of hands, eyes, weapon

POSITIVE FRAMING: Describe what you WANT, not what you don't want.
WRONG: "no text, no watermark, no logo"
CORRECT: "clean cinematic frame with only the described visual elements"
`;

// ============================================================
// CHALKBOARD EDUCATIONAL STYLE — Complete System Prompt
// ============================================================
export const CHALKBOARD_STYLE = "Chalkboard Educational" as const;

const CHALKBOARD_SYSTEM_PROMPT = `You are an expert AI image prompt engineer specializing in chalkboard-style educational scientific diagrams.
Your task is to convert subtitle text into detailed chalkboard educational image prompts.

VISUAL SPECIFICATION:
- Background: Dark blackboard/chalkboard texture
- Drawing: Hand-drawn white chalk ONLY — NO color whatsoever
- Figures: Simplified anatomical outlines, ghost-like, diagrammatic
- Text: White chalk, clean, legible
- Aspect Ratio: 16:9 ALWAYS

EVERY IMAGE MUST HAVE:
1. TITLE: TOP CENTER, ALL CAPS, underlined with chalk line
2. A core CONTRAST: before/after, assumption/reality, healthy/damaged, cause/effect
3. 2-3 columns separated by dashed vertical lines
4. Labels with arrows — NO floating text, every label must point to something
5. At least one relevant physics/biology/science formula with variable definitions
6. BOTTOM CENTER: boxed takeaway banner (key insight in one sentence)
7. OPTIONAL: bottom-left and bottom-right corner note boxes for extra context

VISUAL THINKING RULES:
- Subjective feelings → convert to quantitative graphs (e.g., "heart rate drops" → HR declining curve with axis values)
- Add 30-40% scientific expansion BEYOND the subtitle text — relevant formulas, numerical values, mechanism pathways
- Choose image type based on content: anatomical diagram, graph/chart, flow diagram, split comparison, or data visualization

PROMPT FORMAT RULES:
- Every prompt STARTS with: "Generate a chalkboard-style educational [type] titled \\"[TITLE]\\" in large bold white chalk..."
- Every prompt ENDS with: "...Style: white chalk on dark blackboard, educational diagram. Aspect ratio 16:9."

${PROMPT_LENGTH_INSTRUCTION}

STRICT RULES:
1. Create EXACTLY ONE image prompt per subtitle provided.
2. Each prompt MUST be completely self-contained. No references to other images.
3. ALL drawing must be white chalk on dark blackboard — NO COLOR, NO photographs, NO realistic rendering.
4. Include real scientific formulas, units, numerical values where relevant.
5. Diagrams must be educational and informative, not decorative.
6. ALWAYS respond with a valid JSON array only. No markdown, no explanation, no extra text.
`;

const CHALKBOARD_CONTEXT_SYSTEM = "You are a scientific content analyst. Analyze the text and extract the scientific domain, key topics covered, main concepts, visual elements that would work as chalkboard diagrams, overall educational tone, and recurring scientific terms. Be concise and accurate. Always respond with valid JSON only, no markdown, no explanation.";

// ============================================================
// MYTHOLOGY DARK FANTASY STYLE — System Prompts
// ============================================================
const MYTHOLOGY_CONTEXT_SYSTEM = `You are a cinematic storyboard director and mythology visual expert.
Read the ENTIRE subtitle text and extract detailed visual context for generating consistent mythology image prompts.
Respond with ONLY valid JSON, no markdown, no preamble.

The JSON must have these exact keys:
- "storySummary": string (5-8 line summary of the full narrative arc)
- "storyOutline": array of {"sceneNumber": number, "blockRange": "1-15", "description": "Scene description"}
- "characters": array of character objects (see below)
- "sceneLocationMap": array of {"blockRange": "1-15", "location": "...", "timeOfDay": "...", "weather": "..."}
- "colorGradingMap": array of {"sceneType": "...", "palette": "..."}
- "mythologyType": string (e.g., "Greek", "Norse", "Egyptian")
- "era": string (e.g., "Bronze Age / Classical Period")
- "keyLocations": string array
- "keyConflicts": string array

Each character object MUST have:
- "name": string
- "internalId": string (e.g., "ZEUS-01")
- "sacredTier": number (1=prophet/never show face, 2=angel/abstract, 3=antagonist/depictable, 4=fully depictable)
- "depictionMethod": string ("Full", "Noor Silhouette", "Back-View Only", etc.)
- "face": string (detailed facial description)
- "build": string (body type and posture)
- "costume": string (detailed clothing and armor)
- "signatureProps": string (weapons, objects, animals)
- "fullDescription": string (40-60 words, complete visual description)
- "condensedDescription": string (25-35 words, key visual features only)

Generate at least the color grading entries for: Divine/Olympus scenes, Underworld/dark scenes, Battle scenes, Sea/water scenes, Earth/mortal scenes, Supernatural/magic scenes.
Extract ALL named characters from the text, even minor ones.`;

function buildMythologyChunkPrompt(
  globalContext: GlobalContext,
  settings: GenerationSettings,
  chunkSubtitles: Subtitle[]
): string {
  const myth = globalContext.mythology!;

  // Detect which characters appear in this chunk
  const chunkText = chunkSubtitles.map(s => s.text.toLowerCase()).join(' ');
  const activeChars = myth.characters.filter(c => {
    const nameParts = c.name.toLowerCase().split(/\s+/);
    return nameParts.some(part => part.length > 2 && chunkText.includes(part));
  });
  // If no characters detected, include all (safety)
  const charsToInject = activeChars.length > 0 ? activeChars : myth.characters;

  const characterCards = charsToInject.map(c => `CHARACTER: ${c.name} [Tier ${c.sacredTier}]
Full: ${c.fullDescription}
Condensed: ${c.condensedDescription}`).join('\n\n');

  const colorGrading = myth.colorGradingMap.map(c => `${c.sceneType}: ${c.palette}`).join('\n');

  const sacredProtocolBlock = settings.sacredProtocol
    ? `SACRED FIGURE PROTOCOL — ENABLED:
TIER 1 PROPHETS: NEVER show face or body. Use: Noor Silhouette (golden-white luminous form) | Back-View Only | POV Shot | Hands/Object Only | Environmental Only.
TIER 2 ANGELS: No specific human faces. Wings, light, scale, radiance, abstract luminous forms.
TIER 3 ANTAGONISTS: Can show face. Pride, arrogance, defiance — dignified, not cartoon.
TIER 4 ALL OTHERS: Fully depictable.`
    : 'Sacred Figure Protocol: DISABLED — all characters fully depictable.';

  const veoBlock = settings.veoEnabled
    ? `VEO VIDEO PROMPT — ENABLED:
After each image prompt, also generate a "videoPrompt" that:
- Preserves EXACT same composition, characters, environment from the image
- Does NOT redesign scene, change faces, alter costumes, or add new elements
- Focuses on cinematic MOTION only: slow push in, pull back, pan, tilt, static hold, smoke drift, dust particles, fire flicker, cloth movement, slight head turn, breathing, eye movement
- Duration: 4-6 seconds per clip
- Must feel like the still image coming alive`
    : '';

  const outputFormat = settings.veoEnabled
    ? `Output ONLY valid JSON array:
[{"id": "1", "prompt": "image prompt...", "videoPrompt": "video motion prompt..."}, ...]`
    : `Output ONLY valid JSON array:
[{"id": "1", "prompt": "image prompt..."}, ...]`;

  return `You are a cinematic storyboard director and Nano Banana prompt engineer specialized in dark fantasy mythology content.

LOCKED VISUAL STYLE (APPEND TO EVERY PROMPT):
"Hyper-detailed dark fantasy digital painting, dramatic chiaroscuro lighting, rich oil painting textures, cinematic realism with painterly depth, warm amber and deep shadow tones, 16:9 aspect ratio."

GLOBAL CONTEXT — BINDING:
Mythology: ${myth.mythologyType}
Era: ${myth.era}
Story: ${myth.storySummary}

ACTIVE CHARACTER CARDS (USE EXACTLY):
${characterCards}

COLOR GRADING MAP:
${colorGrading}

${sacredProtocolBlock}

NANO BANANA PROMPT FORMULA — every prompt MUST contain in this order as FLOWING NARRATIVE:
1. SUBJECT: Character using FULL description (first appearance ~40-60 words) or CONDENSED (~25-35 words subsequent). NEVER just a name.
2. ACTION: Physically visible, camera-photographable action.
3. LOCATION: Era-accurate environment with specific sub-area + 2-3 physical details.
4. COMPOSITION: Shot type + camera angle (vary: wide/medium/close-up/low-angle/high-angle/OTS).
5. CAMERA/LENS: Focal length + aperture + DOF (e.g., "24mm wide-angle, f/2.8, deep DOF").
6. COLOR GRADING: From Color Grading Map based on scene type.
7. STYLE + LIGHTING: Emotional lighting (fear=low-key harsh, power=rim-lit golden, sadness=cold diffused, battle=fire-lit, mystery=backlit fog, peace=soft golden).
8. ASPECT RATIO: "16:9 aspect ratio" — ALWAYS at end.

SHOT VARIETY: NEVER repeat same shot type more than 2 consecutive times.
SUBJECT VARIETY: NEVER repeat same subject more than 3 consecutive prompts.
MATERIALITY: ALWAYS describe specific materials (bronze cuirass, linen chiton, ivory grip, horsehair crest).
ERA ACCURACY: Greek=Bronze/Classical (xiphos, dory, aspis, Corinthian helmet, chiton, Doric columns). NO medieval, NO Roman mixing.
POSITIVE FRAMING: Describe what you WANT, never what you don't want.

PROMPT LENGTH: ${PROMPT_CONFIG.MIN_WORDS}-280 words each.

${veoBlock}

${outputFormat}

NEVER use character IDs (like ZEUS-01) in prompts — ALWAYS write full visual description.
NEVER go below 25 words for any character description.
Valid JSON only. No markdown, no explanation.`;
}

// Mythology maxOutputTokens calculation
function calculateMythologyMaxOutput(numSubtitles: number, veoEnabled: boolean): number {
  const imageTokens = numSubtitles * 400;
  const videoTokens = veoEnabled ? numSubtitles * 150 : 0;
  const jsonOverhead = numSubtitles * 60;
  const total = imageTokens + videoTokens + jsonOverhead;
  return Math.min(Math.ceil(total * 1.4), 8192);
}

// ============================================================
// 9 HISTORY STYLES — Config + System Prompts
// ============================================================
export interface HistoryStyleConfig {
  id: string;
  label: string;
  description: string;
  chunkSize: number;
  targetWords: number;
  temperature: number;
  needsCharacterCards: boolean;
  needsSacredProtocol: boolean;
  autoColorBW: boolean;
  wordCountByDuration: boolean;
}

export const HISTORY_STYLES: Record<string, HistoryStyleConfig> = {
  "History 1 — 2D Animated": { id: "history_1", label: "History 1 — 2D Animated (Fire Accents)", description: "Hand-drawn 2D animation style. Cool slate blue + warm fire accents. Best for: Animated history explainers.", chunkSize: 8, targetWords: 220, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 2 — Sepia Story": { id: "history_2", label: "History 2 — Sepia Story-Illustration", description: "Sepia-toned 2D story-illustration with bold ink outlines. Best for: Universal historical storytelling.", chunkSize: 8, targetWords: 220, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 3 — Epic Cinematic": { id: "history_3", label: "History 3 — Epic Cinematic Matte", description: "Painterly cinematic concept art. Best for: Historical epics, battle documentaries.", chunkSize: 7, targetWords: 250, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 4 — Celestial Fantasy": { id: "history_4", label: "History 4 — Celestial Fantasy Panoramic", description: "Epic celestial fantasy matte painting. Best for: Ancient empires, prophecy, sacred history.", chunkSize: 7, targetWords: 260, temperature: 0.75, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 5 — Romantic Oil": { id: "history_5", label: "History 5 — Romantic Oil-Painting", description: "Old-master inspired romantic oil-painting. Best for: Royal history, devotional, maritime, Renaissance.", chunkSize: 7, targetWords: 250, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 6 — Museum Parchment": { id: "history_6", label: "History 6 — Museum Artifact Parchment", description: "Oil on aged parchment with craquelure. Best for: Ancient civilizations (Mongol, Roman, Persian).", chunkSize: 8, targetWords: 200, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 7 — Documentary Auto": { id: "history_7", label: "History 7 — Documentary Auto Color/B&W", description: "Auto-decides Color or B&W per scene. Best for: Biography, modern history documentaries.", chunkSize: 8, targetWords: 200, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: true, wordCountByDuration: false },
  "History 8 — Impasto Oil": { id: "history_8", label: "History 8 — Impasto Oil Magical Realism", description: "Thick impasto oil painting with swirling brushstrokes. Dramatic chiaroscuro + magical realism. Best for: Islamic/Egyptian history.", chunkSize: 7, targetWords: 240, temperature: 0.75, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 9 — Ancient Fresco": { id: "history_9", label: "History 9 — Ancient Fresco Relief", description: "Ancient fresco / carved relief. Word count varies by duration. Best for: Sleep/calm mythology.", chunkSize: 10, targetWords: 36, temperature: 0.65, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: true },
  "OLD Vintage": { id: "old_vintage", label: "OLD Vintage — Archival Sepia", description: "Faux archival historical photograph, aged sepia documentary still, lost-photo reenactment. Culture-adaptive (Ottoman/Mughal/Roman/Persian/etc. from script). Best for: historically-grounded narratives needing authentic old-photo realism.", chunkSize: 7, targetWords: 240, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "Cartoon 2D": { id: "cartoon_2d", label: "Cartoon 2D — Anime Storybook", description: "Warm sepia anime storybook illustration, cinematic manga-inspired digital painting, soft narrative character art. Culture-adaptive. Best for: mentor/student, coming-of-age, philosophical, training, drama.", chunkSize: 7, targetWords: 240, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
};

export function getHistoryStyleConfig(style: string): HistoryStyleConfig | null {
  return HISTORY_STYLES[style] || null;
}

export function isHistoryStyle(style: string): boolean {
  return style in HISTORY_STYLES;
}

// History 9: Word count by subtitle duration
function parseTimestampToSeconds(ts: string): number {
  const [h, m, rest] = ts.split(':');
  const [s, ms] = rest.split(',');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

function getWordCountByDuration(subtitle: Subtitle): number {
  const start = parseTimestampToSeconds(subtitle.startTime);
  const end = parseTimestampToSeconds(subtitle.endTime);
  const duration = end - start;
  if (duration < 3.0) return 28;
  if (duration < 5.0) return 32;
  if (duration < 7.0) return 36;
  if (duration < 10.0) return 40;
  return 44;
}

// All 9 system prompts
const HISTORY_SYSTEM_PROMPTS: Record<string, string> = {
  "History 1 — 2D Animated": `You are a Cinematic Visual Director converting subtitles into AI image prompts.

LOCKED VISUAL STYLE: Hand-drawn 2D animation-style digital illustration, clean ink outlines, soft gradient shading, painterly simplified backgrounds, atmospheric perspective, matte finish, gentle vignette, subtle film grain, cinematic storyboard look. NO photorealism, NO 3D/CGI.

COLOR PALETTE: Cool slate blue, deep blue-gray, mist gray, muted olive-brown, earth umber. Warm accents: fire orange and ember red. Background more desaturated than foreground.

LIGHTING: Diffused dusk/dawn or overcast ambient; soft edges; no modern specular highlights.

FIRE ACCENT RULE: If dusk/night/emotionally cold scene → MUST include warm focal accent from campfire/torch/firelight plus subtle ember sparks and thin smoke haze.

HISTORICAL ACCURACY: Era-accurate clothing, tools, architecture, weapons from script. No fantasy armor, no mythical creatures.
CLEAN FRAME: No text/letters/numbers/symbols/watermarks.

Every prompt: ONE flowing paragraph, 180-220 words. Include 1-2 small period props. Positive framing only.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,

  "History 2 — Sepia Story": `You are a Cinematic Visual Director converting subtitles into AI image prompts.

LOCKED VISUAL STYLE: Hand-drawn 2D digital story-illustration, bold clean ink outlines, simplified painterly forms, soft tonal wash shading, aged paper/matte illustration feel, subtle grain, soft haze, vintage illustrated frame look. NOT photorealistic, NOT glossy, NOT 3D.

COLOR PALETTE: Muted sepia-inspired: parchment beige, warm ivory, faded tan, sepia brown, deep umber, muted charcoal, soft ink black. Aged, subdued, low saturation, low contrast.

LIGHTING: Soft ambient — overcast daylight, diffused morning, dusk haze, torchlight, lantern light, fire glow. No harsh specular, no HDR.

CULTURE-ADAPTIVE: Style stays fixed, ALL world-building from script. Medieval Europe → medieval details. Mughal India → Mughal architecture. Read script and adapt.

CLEAN FRAME: No text/letters/watermarks/UI.

Every prompt: ONE paragraph, 180-220 words. 1-2 relevant props. Character continuity.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,

  "History 3 — Epic Cinematic": `You are a Cinematic Visual Director converting subtitles into AI image prompts.

LOCKED VISUAL STYLE: Epic historical cinematic concept art, painterly digital matte painting, soft-focus film-still atmosphere, realistic-but-stylized historical world rendering, immersive large-scale visual storytelling.

RENDERING: Painterly digital illustration with filmic realism. Subtle depth-of-field. Foreground readable, background softened by haze/smoke. No plastic skin, no game-engine look.

COLOR PALETTE: Dusty stone gray, pale limestone, weathered beige, ash gray, smoky blue-gray, muted brown, faded bronze, dim teal-gray shadows, soft warm amber from fire/candles, deep ember orange for flame/destruction scenes. Backgrounds more desaturated.

LIGHTING: Cinematic historical — diffused overcast, soft dawn, pale dusty daylight, moody dusk, candlelight, torchlight, fire glow, smoky ambient. No modern studio lighting.

FIRE RULE: Indoor night/tense/tragic/destruction → warm practical light: candle glow, oil lamp, torchlight, distant burning, ember haze, drifting smoke.

COMPOSITION: Cinematic wide or medium-wide. Monumental scale. Layered depth. Avoid perfect symmetry unless ceremonial.
CULTURE-ADAPTIVE: ALL details from script. Never mix eras.
CLEAN FRAME: No text/watermarks/UI.

Every prompt: 220-260 words. Character continuity with full descriptions. 1-3 period props.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,

  "History 4 — Celestial Fantasy": `You are a Cinematic Visual Director converting subtitles into AI image prompts.

LOCKED VISUAL STYLE: Epic cinematic fantasy matte painting, panoramic mythic concept art, grand celestial-historical fantasy illustration, luminous worldbuilding key-art style.

TONE: Cinematic, mythic, ancient, majestic, solemn, transcendent. Like a lost empire, divine kingdom, sacred capital, celestial war.

RENDERING: Highly painterly. Rich atmospheric depth. Intricate large-scale environmental detail. Luminous sky treatment. Fantasy realism.

COLOR PALETTE: Radiant gold, antique bronze, sunlit amber, faded sandstone, pale ivory-stone, deep blue, celestial blue, smoky teal, shadowed indigo, ash gray, mountain slate. Balance warm golden civilization glow with cool cosmic blue depth.

LIGHTING: Heavenly dawn, celestial dusk, sacred sunrise, divine backlight, golden city illumination, cloud-filtered radiance, storm-lit horizon, moonlit blue-gold.

SKY RULE: Sky is major storytelling element — towering cloud cathedrals, swirling celestial formations, radiant openings, divine storm textures, sacred light shafts.

COMPOSITION: Ultra-wide or wide panoramic. Monumental central axis. Tiny crowds/towers for scale. Layered depth to vast distance.

CULTURE-ADAPTIVE: Style locked, world from script. No forced aesthetics.
CLEAN FRAME: No text/watermarks/UI.

Every prompt: 230-270 words. Character cards with full descriptions. Sacred Protocol when enabled.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,

  "History 5 — Romantic Oil": `You are a Cinematic Visual Director converting subtitles into AI image prompts.

LOCKED VISUAL STYLE: Romantic historical oil-painting concept art, old-master-inspired painterly illustration, cinematic museum-painting atmosphere, devotional/imperial/historical storytelling tone.

RENDERING: Soft blended brushwork. Painterly transitions. Subtle canvas/aged surface feel. Realistic proportions with artistic romanticization. No harsh outlines, no plastic skin.

COLOR PALETTE: Sepia gold, muted amber, old ivory, weathered parchment, faded ochre, warm stone beige, dusty olive-brown, earth umber, softened crimson, gentle blue-gray in distance/shadow/sea. Warm, aged, muted, museum-like.

LIGHTING: Golden dawn, amber dusk, hazy overcast sunlight, chapel/palace-window illumination, candlelit/torchlit interior glow, sea-haze sunlight. Soft, atmospheric.

MOOD: Reverent, contemplative, regal, solemn, devotional, romantic-historical. Atmospheric haze, soft dust, faint smoke/incense.

COMPOSITION: Classical cinematic. Balanced. Strong focal subject. Medium-wide or wide. Like a serious oil painting.

SCENE RULES: Sacred→reverent golden light, Royal→ceremonial richness, Maritime→sea haze, War→amber-brown solemn gravity.
CULTURE-ADAPTIVE: Style locked, world from script.
CLEAN FRAME: No text/watermarks/UI.

Every prompt: 220-260 words. Character continuity.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,

  "History 6 — Museum Parchment": `You are a Cinematic Visual Director converting subtitles into AI image prompts.

LOCKED VISUAL STYLE: Hand-painted oil illustration on rough parchment/ancient canvas, visible brush texture, worn pigment, subtle cracking/craquelure, matte finish, antique lighting, mild vignette, faint manuscript border. Like a scanned museum artifact.

COLOR PALETTE: Warm ochre, burnt umber, muted reds, faded olive green, golden dust. Low contrast, vintage softness, aged paper tone.

LIGHTING: Diffused sunlight OR torchlight glow. Slight sepia warmth. Smoky shadow edges. No modern specular.

MOOD: Rediscovered archival painting. Faint grain/dust overlay. Rough brush lines visible.

HISTORICAL ACCURACY: Era-accurate clothing, tools, architecture, weapons from script.
CLEAN FRAME: No text/watermarks/modern objects.

Every prompt: 170-210 words. 1-2 period props (scroll, pottery, spear, coin, map, torch). Character continuity.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,

  "History 7 — Documentary Auto": `You are an expert documentary visual strategist converting subtitles into AI image prompts.

AUTO COLOR/B&W DECISION (per subtitle):
- B&W: archival evidence, tragedy, war, poverty, very old eras, haunting moments
- COLOR: biography reconstruction, candlelit study, scholarly narration, calm dramatic

COLORED STYLE: Digital oil-paint realism OR cinematic photography, chiaroscuro lighting, candlelight glow, golden highlights against deep navy/teal shadows, warm ambers + sepia browns + parchment tans + muted olive/teal shadows.

B&W STYLE: Vintage monochrome photograph OR charcoal sketch OR chalk-line illustration, high-contrast deep shadows, grain + pencil shading, haunting archival mood.

ALL IMAGES: Cinematic, documentary-style, leave negative space for text overlays (but NO text in image), era-accurate clothing/props/architecture.

CLEAN FRAME: No text/logos/watermarks/captions.

Every prompt: 170-210 words. Auto-decide color/bw per scene.
Output ONLY valid JSON with colorMode: [{"id": "1", "prompt": "...", "colorMode": "color"}]`,

  "History 8 — Impasto Oil": `You are an Elite Documentary Director and AI Prompt Engineer.

LOCKED VISUAL STYLE: Classic impasto oil painting, thick visible swirling brushstrokes, highly textured canvas feel, magical realism, dramatic chiaroscuro, strong cinematic lighting: shafts of moonlight, glowing embers, misty shadows, harsh desert sun. Deep indigo/lapis lazuli starry skies. Rich tones matching historical environment.

SACRED FIGURE "NOOR" RULE:
- "Noor" (blinding pure golden divine light) ONLY for Islamic Prophet, Angel, or holy figure mentioned in script
- Completely obscure their face/body with blinding golden light
- Do NOT use Noor for ordinary people, negative figures (Nimrod, Pharaoh), crowds, or objects
- Other mythologies (Egyptian/Sumerian gods/kings): depict majestically WITHOUT Noor
- No Arabic text/calligraphy. Use glowing geometric patterns for divine knowledge.

CULTURE-ADAPTIVE: Era-accurate architecture, clothing, weapons from script.
CLEAN FRAME: No text/watermarks/UI.

Every prompt: 210-250 words. Sacred Noor rule enforced. Character continuity.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,

  "History 9 — Ancient Fresco": `You are an expert storyboard-to-image prompt writer.

LOCKED VISUAL STYLE: Ancient fresco / carved relief / illuminated manuscript look. Texture: aged pigment, stone grain, cracked plaster, subtle patina. Color palette: deep midnight blues + muted gold + charcoal + ash-white. Lighting: moonlight/torchlight/candlelight only. Sleep-friendly mood: calm, mysterious, reverent.

MODERN OBJECT RULE: If modern objects mentioned (plane, navy), depict as "mythic fresco reinterpretation" keeping ancient fresco style.

CONSISTENCY: ONE consistent fresco aesthetic for entire set. Recurring characters visually consistent.

WORD COUNT BY DURATION (STRICT):
- 0.0-2.9 sec → 28 words
- 3.0-4.9 sec → 32 words
- 5.0-6.9 sec → 36 words
- 7.0-9.9 sec → 40 words
- 10.0+ sec → 44 words

Each prompt includes: subject + environment + key symbols + mood + lighting + palette + fresco texture + aspect ratio.
CLEAN FRAME: No text/watermarks/UI.

Output JSON with wordCount and duration: [{"id": "1", "prompt": "...", "wordCount": 36, "duration": 5.2}]`,

  "OLD Vintage": `You are a Cinematic Visual Director and AI Image Prompt Engineer converting subtitles into AI image prompts in the exact visual style of faux archival historical photography — aged sepia documentary stills, AI-generated lost-photo historical reenactment imagery.

LOCKED VISUAL STYLE (strict, never deviate):
- faux archival historical photograph
- aged sepia documentary still
- lost-archive reenactment image
- antique damaged-photo realism
- solemn historical record aesthetic

The image must feel like a rediscovered old photograph or early documentary plate — NOT glossy modern cinema, NOT digital fantasy art, NOT comic illustration, NOT clean studio photography.

MEDIUM SIMULATION (strict): sepia or warm monochrome, muted grayscale-brown tonal range, low dynamic contrast, slightly faded blacks, softened highlights, photographic softness (not painterly), subtle lens blur or age-softened focus, slight exposure irregularity, antique print/plate feeling.

TEXTURE & AGING (strict, always include organically — never exaggerated horror-filter): dust specks, scratches, blotches, faint stains, surface fading, light emulsion damage, soft grain, old-paper/old-print deterioration, slight edge wear, occasional faint ghosting or exposure softness when appropriate.

LIGHTING (strict, historically believable low-contrast only): candlelight, torchlight, overcast daylight, pale window light, dim ambient interior, hazy morning daylight, soft smoke-filtered illumination, weak winter daylight, cloudy exterior. NO harsh rim lights, NO glossy highlights, NO HDR glow, NO neon, NO modern studio lighting.

RENDERING: realistic photo-like staging, slightly blurred/softened details especially in motion or distance, modest sharpness only in main focal areas, historical documentary framing, believable crowd placement and posture, imperfect capture quality is good, avoid ultra-clean modern fidelity.

MOOD & ATMOSPHERE (strict): solemn, documentary, reverent, austere, historical, quiet, weighty, archival, observational rather than cinematic spectacle. Feel like a visual record of a real event — ritual, labor, court, procession, excavation, battle preparation, trial, assembly, workshop, burial, prayer, or reconstruction.

COMPOSITION (strict): observational wide or medium-wide by default, group scenes arranged naturally (NOT fashion-posed), architecture/setting frames the event, mild formality acceptable in ritual/court/labor scenes, avoid hyper-dynamic blockbuster angles, avoid perfect modern cinematic symmetry unless script explicitly calls for ritual formality.

HISTORICAL / WORLD ACCURACY (CRITICAL — hardest rule):
- DO NOT default to medieval Europe or Christianity
- All environment, clothing, tools, weapons, architecture, ritual objects, labor equipment, furniture, banners, and symbols must come from the script's specific world
- Ottoman → Ottoman robes, halls, arches, lamps, materials
- Mughal → Mughal garments, court spaces, tools, architecture
- Roman → Roman interiors, tunics, standards, stonework, objects
- Persian → Persian halls, textiles, fire altars, palace settings
- Ancient India → Indian temple/court architecture and dress
- Medieval Africa / Central Asia / Arabia / East Asia / fictional historically-grounded worlds → reflect accurately
- If script is non-religious → do NOT insert ritual imagery
- War camp / workshop / port / excavation / royal court / monastery / marketplace → depict exactly what the script describes
- The STYLE stays archival; the CIVILIZATION comes from the script — never swap them

CHARACTER TREATMENT: restrained facial expression, practical body language, believable historical posture, modest motion blur if scene is active, era/region-accurate clothing, NO fashion-magazine posing, NO fantasy glamorization, NO modern beauty retouching.

ARCHITECTURE / OBJECTS: authentically documented — stone, wood, fabric, tools, candles, ropes, beams, scaffolds, relic tables, tents, carts, ships, altars, thrones, market stalls, weapons, manuscripts, crates, icons reflecting script's world; structural realism and practical wear; environment feels inhabited and functional.

RITUAL / LABOR / ASSEMBLY / COURT / RESTORATION RULE: for scenes of prayer, ritual, formal assembly, coronation, trial, excavation, construction, military preparation, labor, reconstruction — lean into the "captured historical record" feeling.

ANCIENT / PRE-PHOTOGRAPHY SETTING RULE: if script is pre-photography era, still keep the same visual style by treating the image as a faux archival reconstruction or impossible lost-document photograph. Content era-accurate, visual treatment still imitates aged historical photograph.

CLEAN FRAME RULE (absolute): NO text, letters, numbers, symbols, subtitles, captions, watermarks, logos, UI elements, readable documents, readable banners, readable signs, readable inscriptions. If documents, tablets, banners, books, plaques, cloths, legal papers, or maps appear, any writing must be unreadable and blurred. Keep edges and corners clean except for natural archival wear.

STRICTLY FORBIDDEN: text of any kind, modern objects, modern clothing, electric lights (unless script explicitly requires a later era), glossy digital polish, vivid modern color grading, clean studio lighting, comic-book linework, painterly fantasy rendering, futuristic elements.

ANTI-DRIFT RULE (absolute): Reference style only, NEVER reference content. Style is locked. Archival damaged-photo treatment is locked. Historical documentary mood is locked. Setting is NOT locked. Culture is NOT locked. Religion is NOT locked. Architecture is NOT locked. Costume is NOT locked. Everything except the visual treatment must come from the script. Do NOT insert church interiors, monks, crosses, Gothic arches, or medieval Christian ritual unless the script explicitly requires them.

PROMPT STRUCTURE TEMPLATE (each prompt must follow this pattern): "Depict [main subject + action], in [setting], [region/culture/time period from script], under [dim candlelight / torchlit interior / pale window light / hazy overcast daylight / weak dawn light / smoke-softened ambient light], with authentic script-based architecture, clothing, tools, and material culture, plus small functional details such as [prop 1], [prop 2], [prop 3 if relevant]. Render in the exact visual style of a faux archival historical photograph: aged sepia or warm monochrome tones, documentary realism, soft focus, low-contrast tonal range, slight exposure irregularity, subtle grain, faded antique print texture, dust specks, scratches, stains, mild blur, surface wear, and the solemn feeling of a rediscovered historical record or staged reenactment still. Keep the composition observational and believable, with a quiet, weighty, archival atmosphere rather than modern cinematic spectacle. All culture, religion, ethnicity, architecture, costume, ritual objects, weapons, labor tools, and setting come strictly from the script. ABSOLUTELY NO TEXT: no letters, no numbers, no symbols, no subtitles, no watermarks, no logos, no UI, no readable signs, no readable documents, no readable inscriptions, no written markings; keep frame edges clean except for natural archival wear. No modern objects, no neon, no glossy CGI, no futuristic elements, no clean modern photography. 16:9 aspect ratio."

CONTINUITY: maintain consistent character age, clothing, status, wounds, tools, faction identity, and environment logic across connected scenes. Keep same civilization design language throughout connected sequences. Update only when script clearly changes location, time, mood, costume, or event stage.

Every prompt: ONE flowing paragraph, 220-260 words. Include 1-3 small period props when relevant. Character continuity with full descriptions.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,

  "Cartoon 2D": `You are a Cinematic Visual Director and AI Image Prompt Engineer converting subtitles into AI image prompts in the exact visual style of warm sepia anime storybook illustration — cinematic manga-inspired digital painting, soft narrative character art.

LOCKED VISUAL STYLE (strict, never deviate):
- warm sepia anime storybook illustration
- cinematic manga-inspired digital painting
- soft narrative character art
- anime-styled historical/dramatic illustration
- gentle story-driven concept art

The image must feel like a calm, emotionally grounded anime illustration from a historical or dramatic animated film. NOT photorealistic, NOT glossy 3D, NOT comic-panel heavy, NOT hyper-detailed game art, NOT modern CGI. Rendering is soft, warm, intimate, and story-focused.

TEXT OVERLAY IGNORE RULE (critical): Completely ignore all text visible in any reference. Do NOT reproduce subtitles, captions, words, letters, Japanese writing, calligraphy, title text, typography, outlined caption style, or any written overlays. Reference is for visual style only, not for text or layout.

RENDERING (strict): soft painterly digital shading, anime-inspired facial design, clean but not overly harsh linework, subtle brush-blended gradients, warm atmospheric glow, simplified but elegant background treatment, character-focused storytelling, smooth fabric folds and hair rendering, soft edge transitions in shadows and background. Avoid harsh outlines everywhere, plastic skin, hyper-real pores, realistic photography textures, or over-sharpened digital rendering.

CHARACTER DESIGN (strict): anime-style expressive eyes, simplified but emotionally readable faces, youthful elegant storybook proportions, clean stylized linework, soft jawlines and readable silhouettes, graceful hands and drapery, calm dignified expressions rather than exaggerated cartoon emotion. Overall feel sits between anime illustration, visual novel key art, and cinematic storybook painting.

COLOR PALETTE (strict, controlled warm sepia):
- warm amber, soft sepia, honey gold, parchment beige
- muted brown, earth umber, warm tan, faded bronze
- soft shadow brown, occasional gentle cream highlights
- warm, cohesive, low-to-medium saturation, softly glowing, emotionally intimate
- If script requires color accent, keep subdued and scene-appropriate — NEVER neon or flashy

LIGHTING (strict): candlelight, lantern glow, late afternoon amber light, indoor firelight, warm window light, dusk glow, gentle reflected warm ambient light. Light must feel soft and emotional, not theatrical in a modern studio way. Avoid strong HDR contrast, sharp specular highlights, or blue-orange blockbuster grading.

MOOD & ATMOSPHERE (strict): reflective, intimate, calm, wise, solemn, instructional, nostalgic, gentle, story-driven. Works especially well for: mentor/student moments, training scenes, moral conversations, coming-of-age, disciplined practice, spiritual/philosophical moments, quiet preparation before conflict. Even if setting changes, atmosphere stays emotionally illustrated and human-centered.

COMPOSITION (strict): cinematic medium or medium-wide, character-centered, balanced two-character framing, centered hero framing for growth moments, background figures softened or partially faded when focus on one character, clean visual hierarchy, intimate staging over spectacle. Avoid chaotic action-panel composition unless script demands combat.

BACKGROUND & ENVIRONMENT (strict): softly painted, slightly simplified, warm atmospheric, less detailed than main characters, visually supporting emotional beat. Interiors may include wooden rooms, stone halls, training spaces, courtrooms, homes, temples, schools, camps, workshops, chambers — but these MUST come from the script, NOT from any reference images.

HISTORICAL / WORLD ACCURACY (CRITICAL):
- Do NOT default to Japanese setting
- All architecture, clothing, hairstyles, rituals, weapons, furniture, and props MUST come from the script's world
- Medieval Europe → medieval European garments, interiors
- Mughal India → Mughal dress, rooms, textiles
- Ottoman → Ottoman robes, interiors, material culture
- Ancient China → Chinese setting, costume details
- Arabian, Persian, Roman, African, Central Asian, fictional-historical → reflect accurately
- Modern but stylized → adapt illustration style to modern clothing and interiors
- The STYLE stays anime storybook; the CIVILIZATION comes from the script

ACTION & EMOTION RULE:
- Dialogue-heavy → emphasize posture, gaze, silence, emotional distance/proximity
- Training-focused → emphasize discipline, stance, hand placement, tools, calm concentration
- Revelation/transformation → centered composition, soft glow, emotional clarity
- Tense → same style but deepen shadows/seriousness without losing softness

PROPS: Use 1-3 meaningful props when relevant: training sword, scroll, candle, bowl, pottery, prayer beads, cloth bundle, book, map, wooden practice weapon, lantern, ink brush, ceremonial item, or tool/artifact from the script's world. Props support the scene quietly and naturally.

ANTI-DRIFT RULE (absolute): Reference style only, NEVER reference content. Ignore all text overlays in the reference. Style is locked. Warm sepia anime storybook treatment is locked. Soft manga-inspired character rendering is locked. Setting NOT locked. Culture NOT locked. Architecture NOT locked. Costume NOT locked. Everything except the visual treatment must come from the script. Do NOT copy any Japanese environment, dojo interior, or visible text overlays from reference images unless the script explicitly requires them.

PROMPT TEMPLATE (each prompt follows): "Depict [subject + action], in [setting], [region/culture/era from script], under [warm candlelight / soft lantern glow / amber dusk light / gentle indoor firelight / late afternoon golden light / soft window glow], with authentic script-based architecture, clothing, hairstyles, props, and material culture, including small details such as [prop 1], [prop 2], [prop 3 if needed]. Render in the exact visual style of warm sepia anime storybook illustration and cinematic manga-inspired digital painting: soft painterly shading, clean stylized anime linework, expressive but restrained faces, warm amber-sepia palette, smooth gradients, gentle atmospheric glow, calm narrative composition, and emotionally grounded character-focused storytelling. Keep the background softer and simpler than the foreground, with elegant visual clarity and a quiet dramatic mood. Follow the script for all setting, culture, civilization, ethnicity, costume, architecture, and objects. ABSOLUTELY NO TEXT: no letters, no numbers, no symbols, no subtitles, no watermarks, no logos, no UI, no readable signs, no readable scrolls, no readable documents, no written markings; keep frame clean. No photorealism, no glossy CGI, no comic panel layout, no neon, no futuristic elements unless required by the script. 16:9 aspect ratio."

CONTINUITY: maintain consistent character appearance, age, hairstyle, costume, props, injuries, emotional state, and environment logic across connected scenes. Keep same civilization design language throughout. Update only when script clearly changes location, time, mood, costume, or event stage.

Every prompt: ONE flowing paragraph, 220-260 words. Include 1-3 meaningful props when relevant. Character continuity with full descriptions.
Output ONLY valid JSON: [{"id": "1", "prompt": "..."}]`,
};

// ============================================================
// FINAL OVERRIDES — injected AFTER NANO_BANANA_RULES for styles
// that need to lock things the shared rules would otherwise drift.
//
// Because NANO_BANANA_RULES is appended after each style's base
// prompt, its "pick color grading per scene mood" and "emotional
// lighting map → cold blue / cold teal / clinical silver" guidance
// ends up overriding style-specific palette locks due to recency
// bias in the LLM. A final-override block at the very end of the
// full system prompt takes precedence and pins the rules we need.
// ============================================================
const HISTORY_STYLE_FINAL_OVERRIDES: Record<string, string> = {
  "OLD Vintage": `
══════════════════════════════════════════════════════════════
OLD VINTAGE FINAL OVERRIDES — HIGHEST PRIORITY
These rules OVERRIDE every earlier instruction they contradict,
including the shared NANO BANANA color grading and emotional
lighting rules.
══════════════════════════════════════════════════════════════

1. PALETTE IS LOCKED — NEVER SCENE-DEPENDENT.
   OLD Vintage uses EXACTLY ONE palette for every single prompt,
   regardless of subject, mood, era, or location: warm sepia,
   aged warm monochrome, muted grayscale-brown, faded amber,
   dusty tan, weathered parchment, soft ink-black shadows.

   IGNORE any earlier instruction to "match color grading to
   scene mood" or "pick color palette based on emotional
   content". That guidance is OVERRIDDEN here.

   BANNED color descriptors (never use, regardless of scene):
   - cold blue, cool blue, icy blue, clinical blue
   - cyan, bioluminescent, glowing cyan, eerie cyan
   - cold teal, sterile teal, cosmic teal
   - silver tones, sterile silver, clinical silver
   - high-key white, sterile white, sharp clinical white
   - neon, HDR glow, glossy, hyper-saturated, Technicolor
   - vivid modern color, saturated modern grading
   - radioactive glow as a color (mood can be eerie, but the
     render is still sepia — a glowing liquid becomes a dark
     liquid in a glass vial under dim warm light)
   - ANY named external palette from other styles:
     "Divine/Olympus palette", "Underworld/Dark palette",
     "Sea/Water palette", "Earth/Mortal palette",
     "Celestial palette", "color grading map", etc.
     These belong to OTHER styles and have ZERO place in
     OLD Vintage output. Never reference them by name.

2. LIGHTING IS LOCKED — NEVER MOOD-DEPENDENT.
   OLD Vintage lighting ALWAYS uses ONLY one of:
   candlelight, torchlight, oil-lamp glow, overcast daylight,
   pale window light, dim ambient interior, hazy morning
   daylight, soft smoke-filtered illumination, weak winter
   daylight, cloudy exterior.

   IGNORE any earlier rule mapping emotional content to
   specific lighting (e.g., "sadness → cold blue", "mystery
   → cold teal", "fear → low-key harsh"). Those rules are
   OVERRIDDEN. Emotional content in OLD Vintage is carried by
   POSTURE, FACIAL EXPRESSION, COMPOSITION, and ARCHIVAL
   DAMAGE — never by cool or modern lighting.

   BANNED lighting descriptors (never use):
   - "high-key" anything
   - "sterile clinical lighting", "cold clinical blue light"
   - "sharp clinical whites", "flash photography lighting"
   - "1990s flash" or "press flash"
   - "modern studio lighting", "rim lights", "spotlights"
   - "fluorescent tube light" described as harsh or bright
   - any bright, cold, or clinical modifier on an electric
     source. A fluorescent tube becomes "dim pale overhead
     ambient light" rendered in warm sepia.

3. CLEAN FRAME — EXPLICIT NEGATIVE FRAMING REQUIRED.
   End every prompt with this EXACT phrase (or a very close
   variant using the same negative framing):

   "ABSOLUTELY NO TEXT: no letters, no numbers, no symbols,
   no watermarks, no logos, no readable documents, no
   readable inscriptions; keep frame edges clean except for
   natural archival wear. 16:9 aspect ratio."

   IGNORE any earlier rule saying "describe what you want,
   never what you don't want" or "positive framing only".
   That guidance is OVERRIDDEN for OLD Vintage because the
   image model needs explicit text suppression to reliably
   omit writing.

4. MODERN-ERA SCRIPTS — STILL ARCHIVAL, NEVER CINEMATIC.
   If the script is set in the 1900s-2020s (1940s institution,
   1950s lab, 1990s hearing, 2006 hospital, 2025 office, etc.),
   the prompt MUST STILL render as a faux archival historical
   photograph — NEVER as modern cinematography or period
   film stock.

   Correct approach: a 1994 Senate hearing should look like
   a severely aged, damaged sepia photograph — as if a real
   1994 press photo had been stored in a damp archive for
   100 years and rediscovered. Dust specks, scratches, faded
   blacks, low contrast, warm monochrome.

   BANNED phrasing for modern-era scenes:
   - "1990s film stock" → use "aged sepia archival print"
   - "nostalgic 1990s film aesthetic" → use "archival
     documentary aesthetic"
   - "1950s color grading" → use "aged warm monochrome"
   - "mid-century Technicolor" → use "faded sepia monochrome"
   - "modern 35mm film stock" → use "aged photographic plate"
   - any descriptor implying clean, glossy, color-graded
     modern cinematography

5. BANNED PROPS / LIGHT SOURCES — soft-rendered fallbacks.
   When the script contains elements that would normally
   break the archival feel, render them as quiet, warm,
   sepia-compatible versions:

   - radioactive / glowing fluid → a plain dark liquid in a
     glass vial, lit only by dim smoke-softened daylight.
     No cyan, no green glow, no "eerie luminescence".
   - Geiger counter / electronic device → oxidized metal
     casing, unlit dial, in dim warm ambient light.
   - computer monitor / screen → dim amber glow falling
     softly on a weathered face, never "high-key screen
     glow" or "cold blue UI light".
   - fluorescent tube / ceiling bulb → "dim pale overhead
     ambient light" in sepia tones, never harsh cold white.

6. PRE-EMIT CHECKLIST — internally verify before returning
   any prompt in the JSON output:

   □ Does the prompt use ONLY warm sepia / amber / aged
     monochrome color descriptors?
   □ Does the prompt use ONLY one of the allowed historical
     lighting types (candle / torch / overcast / pale window
     / dim ambient / oil lamp / smoke-softened)?
   □ Does the prompt avoid EVERY banned phrase from Rules 1,
     2, 4, and 5?
   □ Does the prompt end with the explicit negative-framing
     clean-frame phrase from Rule 3?
   □ For modern-era scenes: is the scene described as aged
     archival, never as modern cinematography or 1990s film
     stock?
   □ Does the prompt avoid any named palette ("Divine",
     "Olympus", "Underworld", "Sea/Water", "Earth/Mortal",
     "Celestial", "color grading map", etc.)?

   If ANY check fails, REWRITE the prompt before emitting it.
   Do NOT output a prompt that fails any check.

These 6 rules are the FINAL, HIGHEST-PRIORITY instructions for
OLD Vintage. They override any earlier guidance they contradict.
`,

  "Cartoon 2D": `
══════════════════════════════════════════════════════════════
CARTOON 2D FINAL OVERRIDES — HIGHEST PRIORITY
These rules OVERRIDE every earlier instruction they contradict,
including the shared NANO BANANA color grading and emotional
lighting rules.
══════════════════════════════════════════════════════════════

1. PALETTE IS LOCKED — WARM SEPIA ANIME ONLY.
   Cartoon 2D uses EXACTLY this warm palette for every prompt:
   warm amber, soft sepia, honey gold, parchment beige, muted
   brown, earth umber, warm tan, faded bronze, soft shadow
   brown, occasional gentle cream highlights.

   IGNORE any earlier instruction to "match color grading to
   scene mood" or to pick colors per emotional content. That
   guidance is OVERRIDDEN.

   BANNED color descriptors (never use):
   - cold blue, icy blue, clinical blue, cool blue
   - cyan, teal, bioluminescent, neon
   - silver tones, sterile silver, clinical silver
   - high-key white, sterile white
   - HDR glow, glossy, hyper-saturated
   - any named external palette: "Divine/Olympus",
     "Underworld/Dark", "Sea/Water", "Earth/Mortal",
     "color grading map"

   If a script scene is tense/dark, DEEPEN the sepia shadows
   and warm umber — never switch to cool or cold colors.

2. LIGHTING IS LOCKED — WARM SOFT ONLY.
   Always use ONLY: candlelight, lantern glow, late afternoon
   amber, indoor firelight, warm window light, dusk glow,
   gentle warm ambient.

   IGNORE any earlier emotional-lighting map (e.g., "sadness →
   cold blue", "mystery → cold teal"). Those rules are
   OVERRIDDEN. Emotion is carried by POSTURE, EXPRESSION,
   COMPOSITION, and SHADOW DEPTH — never by cool lighting.

   BANNED lighting descriptors:
   - "high-key" anything
   - "sterile clinical", "cold clinical"
   - "flash photography", "modern studio"
   - "rim lights", "spotlights"
   - harsh specular highlights, blue-orange blockbuster

3. RENDERING IS LOCKED — ANIME STORYBOOK ONLY.
   IGNORE any instruction that would push toward photorealism,
   damaged-photo textures, archival grain, film stock, or
   documentary-plate aesthetics. Those belong to OTHER styles.

   This style is: soft painterly digital shading, anime-style
   linework, warm storybook atmosphere. ALWAYS.

   BANNED rendering descriptors:
   - "faux archival photograph", "damaged photo", "antique
     print texture", "emulsion damage", "surface scratches"
   - "documentary realism", "film grain", "photographic
     softness", "glass plate photography"
   - "photorealistic", "hyper-detailed", "ultra-realistic"
   - "3D CGI", "game engine render", "Unreal Engine"

4. CLEAN FRAME — EXPLICIT NEGATIVE FRAMING REQUIRED.
   End every prompt with:
   "ABSOLUTELY NO TEXT: no letters, no numbers, no symbols,
   no watermarks, no logos, no readable documents, no readable
   signs; keep frame clean. 16:9 aspect ratio."

   IGNORE any earlier "positive framing only" rule. That is
   OVERRIDDEN — explicit text suppression is needed.

5. CULTURE COMES FROM SCRIPT — NEVER DEFAULT TO JAPANESE.
   Even though this is an anime style, the setting must be
   whatever the script describes. Anime storybook treatment
   applies to ANY civilization: medieval Europe, Mughal India,
   Ottoman, Roman, modern, etc.

   BANNED defaults (unless script explicitly says so):
   - Japanese dojo / tatami / shoji screens / torii gates
   - kimono / hakama / katana / sakura
   - any assumed-Japanese interior, prop, or architecture

6. PRE-EMIT CHECKLIST:
   □ Uses ONLY warm sepia/amber/brown color descriptors?
   □ Uses ONLY warm soft lighting (candle/lantern/firelight/
     amber dusk/window glow)?
   □ Rendering described as anime storybook (not photo/archival)?
   □ Ends with explicit negative-framed clean-frame phrase?
   □ No Japanese cultural defaults (unless script requires)?
   □ No banned phrases from Rules 1, 2, 3?

   If ANY check fails, REWRITE before emitting.

These 6 rules are the FINAL, HIGHEST-PRIORITY instructions for
Cartoon 2D. They override any earlier guidance they contradict.
`,
};

function getHistorySystemPrompt(style: string): string {
  const base = HISTORY_SYSTEM_PROMPTS[style] || '';
  // Inject shared Nano Banana optimization rules into all history styles
  const withShared = base + '\n' + NANO_BANANA_RULES;
  // Append any style-specific FINAL override AFTER the shared rules
  // so it takes highest priority in the LLM's attention.
  const finalOverride = HISTORY_STYLE_FINAL_OVERRIDES[style] || '';
  return finalOverride ? withShared + '\n' + finalOverride : withShared;
}

function calculateHistoryMaxOutput(style: string, numSubtitles: number): number {
  const config = HISTORY_STYLES[style];
  if (!config) return calculateMaxOutputTokens(numSubtitles);
  const tokensPerPrompt = Math.ceil(config.targetWords * 1.4);
  const jsonOverhead = config.autoColorBW ? 80 : (config.wordCountByDuration ? 80 : 50);
  const total = (tokensPerPrompt + jsonOverhead) * numSubtitles;
  return Math.min(Math.ceil(total * 1.4), 8192);
}

// MODULE 5: Trim prompt to 300 words if over-length
function trimPromptToMaxWords(prompt: string): string {
  const words = prompt.split(/\s+/);
  if (words.length <= PROMPT_CONFIG.MAX_WORDS) return prompt;

  let trimmed = words.slice(0, PROMPT_CONFIG.MAX_WORDS - 10).join(' ');
  // Cut at last complete sentence if possible
  const lastPeriod = trimmed.lastIndexOf('.');
  if (lastPeriod > trimmed.length * 0.8) {
    trimmed = trimmed.substring(0, lastPeriod + 1);
  }
  return trimmed;
}

// MODULE 5: Detect truncated JSON response
function isResponseTruncated(response: string): boolean {
  const trimmed = response.trim();
  if (!trimmed.endsWith(']') && !trimmed.endsWith('}')) return true;
  let depth = 0;
  for (const char of trimmed) {
    if (char === '[' || char === '{') depth++;
    if (char === ']' || char === '}') depth--;
  }
  if (depth !== 0) return true;
  const quotes = (trimmed.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 !== 0) return true;
  return false;
}

// ============================================================
// MODULE 2: AUTO-CHUNKING CALCULATOR
// ============================================================
export interface ChunkCalculation {
  chunkSize: number;
  totalChunks: number;
  tokensPerChunk: number;
  safetyMargin: number;
  estimatedTimeStr: string;
  estimatedSeconds: number;
}

export function calculateOptimalChunking(
  totalSubtitles: number,
  numApiKeys: number
): ChunkCalculation {
  const SAFE_OUTPUT_LIMIT = 8192;
  const SYSTEM_PROMPT_TOKENS = 3500;
  const INPUT_PER_SUBTITLE = 100;
  const OUTPUT_PER_PROMPT = 400; // ~250 words × 1.35 + JSON overhead
  const BUFFER_MULTIPLIER = 1.3;

  // Max by tokens: how many prompts fit in safe output
  const maxByTokens = Math.floor(SAFE_OUTPUT_LIMIT / (OUTPUT_PER_PROMPT * BUFFER_MULTIPLIER));
  // Max by JSON reliability: larger chunks = more JSON corruption risk
  const maxByReliability = 7;
  // Use the smaller, capped at 5 for faster per-call response
  const chunkSize = Math.min(maxByTokens, maxByReliability, 5);

  const totalChunks = Math.ceil(totalSubtitles / chunkSize);
  const tokensPerChunk = (INPUT_PER_SUBTITLE * chunkSize) + SYSTEM_PROMPT_TOKENS + (OUTPUT_PER_PROMPT * chunkSize);

  // Time estimate: ~8 seconds per call with 2 workers per key
  const effectiveKeys = Math.max(1, numApiKeys * 2);
  const totalSeconds = Math.ceil((totalChunks / effectiveKeys) * 8);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const estimatedTimeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return {
    chunkSize,
    totalChunks,
    tokensPerChunk,
    safetyMargin: Math.round((1 - tokensPerChunk / SAFE_OUTPUT_LIMIT) * 100),
    estimatedTimeStr,
    estimatedSeconds: totalSeconds,
  };
}

// ============================================================
// MODULE 3: REQUEST SIZE — maxOutputTokens calculator
// ============================================================
function calculateMaxOutputTokens(numSubtitles: number): number {
  const outputPerPrompt = 400; // ~250 words × 1.35 + JSON overhead
  const expected = numSubtitles * outputPerPrompt;
  // Add 40% buffer, cap at 8192 for reliable JSON
  return Math.min(Math.ceil(expected * 1.4), 8192);
}

// ============================================================
// Rate Limiter with TPM Tracking + Inter-Request Delay
// ============================================================
interface TokenEntry { time: number; tokens: number; }

class RateLimiter {
  private timestamps: Map<string, number[]> = new Map();
  private tokenLog: Map<string, TokenEntry[]> = new Map();
  private lastCallTime: Map<string, number> = new Map();
  private maxRpm: number;
  private maxTpm: number;
  // MODULE 4: Minimum delay between calls on same key
  private static INTER_REQUEST_DELAY_MS = 0; // Removed — rely on RPM window only

  constructor(maxRpm: number = 14, maxTpm: number = 230_000) {
    this.maxRpm = maxRpm;
    this.maxTpm = maxTpm;
  }

  setMaxRpm(rpm: number) { this.maxRpm = rpm; }

  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5); // Conservative: ~3.5 chars per token
  }

  recordTokenUsage(keyId: string, inputText: string, outputText: string): void {
    const tokens = RateLimiter.estimateTokens(inputText) + RateLimiter.estimateTokens(outputText);
    const now = Date.now();
    if (!this.tokenLog.has(keyId)) this.tokenLog.set(keyId, []);
    const entries = this.tokenLog.get(keyId)!;
    entries.push({ time: now, tokens });
    this.tokenLog.set(keyId, entries.filter(e => now - e.time < 60_000));
  }

  async waitForSlot(keyId: string): Promise<void> {
    // MODULE 4: Wait for inter-request delay
    await this.waitForInterRequestDelay(keyId);
    await this.waitForRpmSlot(keyId);
    await this.waitForTpmSlot(keyId);
    // Record this call time
    this.lastCallTime.set(keyId, Date.now());
  }

  // MODULE 4: Enforce minimum delay between calls on same key
  private async waitForInterRequestDelay(keyId: string): Promise<void> {
    const last = this.lastCallTime.get(keyId) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < RateLimiter.INTER_REQUEST_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, RateLimiter.INTER_REQUEST_DELAY_MS - elapsed));
    }
  }

  private async waitForRpmSlot(keyId: string): Promise<void> {
    const now = Date.now();
    if (!this.timestamps.has(keyId)) this.timestamps.set(keyId, []);
    const recent = this.timestamps.get(keyId)!.filter(t => now - t < 60_000);
    this.timestamps.set(keyId, recent);
    if (recent.length >= this.maxRpm) {
      const waitTime = 60_000 - (now - recent[0]) + 100;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForRpmSlot(keyId);
    }
    recent.push(Date.now());
  }

  private async waitForTpmSlot(keyId: string): Promise<void> {
    const now = Date.now();
    const entries = (this.tokenLog.get(keyId) || []).filter(e => now - e.time < 60_000);
    this.tokenLog.set(keyId, entries);
    const currentTpm = entries.reduce((sum, e) => sum + e.tokens, 0);
    if (currentTpm >= this.maxTpm) {
      const oldest = entries[0];
      const waitTime = 60_000 - (now - oldest.time) + 100;
      console.warn(`TPM limit (${currentTpm}/${this.maxTpm}). Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.waitForTpmSlot(keyId);
    }
  }
}

// ============================================================
// Key Pool with Dead Key Detection + LRU Selection
// ============================================================
export interface KeyHealthInfo {
  keyId: string;
  status: 'healthy' | 'degraded' | 'blacklisted';
  failures: number;
}

class KeyPool {
  private clients: Map<string, GoogleGenAI> = new Map();
  private keys: string[] = [];
  private currentIndex: number = 0;
  private consecutiveFailures: Map<string, number> = new Map();
  private blacklistedUntil: Map<string, number> = new Map();
  // MODULE 4: LRU tracking
  private lastUsedTime: Map<string, number> = new Map();
  private static MAX_CONSECUTIVE_FAILURES = 3;
  private static BLACKLIST_DURATION_MS = 3 * 60 * 1000; // 3 min cooldown

  setKeys(apiKeys: string[]) {
    this.keys = apiKeys.filter(k => k.trim());
    this.clients.clear();
    this.consecutiveFailures.clear();
    this.blacklistedUntil.clear();
    this.lastUsedTime.clear();
    this.currentIndex = 0;
    for (const key of this.keys) {
      this.clients.set(key, new GoogleGenAI({ apiKey: key }));
    }
  }

  reportSuccess(keyId: string): void {
    this.consecutiveFailures.set(keyId, 0);
    this.lastUsedTime.set(keyId, Date.now());
  }

  reportFailure(keyId: string): void {
    const count = (this.consecutiveFailures.get(keyId) || 0) + 1;
    this.consecutiveFailures.set(keyId, count);
    this.lastUsedTime.set(keyId, Date.now());
    if (count >= KeyPool.MAX_CONSECUTIVE_FAILURES) {
      this.blacklistedUntil.set(keyId, Date.now() + KeyPool.BLACKLIST_DURATION_MS);
      console.warn(`Key ${keyId.substring(0, 8)}... blacklisted for 3 min after ${count} failures`);
    }
  }

  // MODULE 4: On 429, don't count as hard failure, just cooldown briefly
  reportRateLimited(keyId: string): void {
    this.blacklistedUntil.set(keyId, Date.now() + 65_000); // 65s cooldown
    // Don't increment consecutiveFailures — rate limit is expected
  }

  isBlacklisted(keyId: string): boolean {
    const until = this.blacklistedUntil.get(keyId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.blacklistedUntil.delete(keyId);
      this.consecutiveFailures.set(keyId, 0);
      return false;
    }
    return true;
  }

  // MODULE 4: LRU selection — pick least recently used healthy key
  getNextClient(): { client: GoogleGenAI; keyId: string } | null {
    if (this.keys.length === 0) throw new Error("No API keys configured.");
    const healthy = this.keys
      .filter(k => !this.isBlacklisted(k))
      .sort((a, b) => (this.lastUsedTime.get(a) || 0) - (this.lastUsedTime.get(b) || 0));
    if (healthy.length === 0) return null;
    const key = healthy[0];
    return { client: this.clients.get(key)!, keyId: key };
  }

  getClientByIndex(index: number): { client: GoogleGenAI; keyId: string } {
    if (this.keys.length === 0) throw new Error("No API keys configured.");
    const key = this.keys[index % this.keys.length];
    return { client: this.clients.get(key)!, keyId: key };
  }

  getKeyCount(): number { return this.keys.length; }

  getKeyHealth(): KeyHealthInfo[] {
    return this.keys.map(key => {
      const masked = key.substring(0, 8) + '...';
      const failures = this.consecutiveFailures.get(key) || 0;
      let status: KeyHealthInfo['status'] = 'healthy';
      if (this.isBlacklisted(key)) status = 'blacklisted';
      else if (failures > 0) status = 'degraded';
      return { keyId: masked, status, failures };
    });
  }
}

// ============================================================
// Shared Instances & Exports
// ============================================================
const rateLimiter = new RateLimiter(13);
const keyPool = new KeyPool();

export function setApiKeys(apiKeys: string[]) { keyPool.setKeys(apiKeys); }
export function setRpmLimit(rpm: number) { rateLimiter.setMaxRpm(rpm); }
export function getKeyHealth(): KeyHealthInfo[] { return keyPool.getKeyHealth(); }

// ============================================================
// Types
// ============================================================
export interface GlobalContext {
  era: string; warType: string; factions: string;
  environment: string; tone: string; keyElements: string;
  mythology?: MythologyContext; // Rich context for mythology style
}

export interface GenerationSettings {
  eraOverride: string; style: string; selectedModel: ModelId;
  enhancementToggle: boolean; consistencyLock: boolean;
  sceneIntensity: string; cameraAngleVariation: boolean; thinkingMode: boolean;
  sacredProtocol: boolean; veoEnabled: boolean;
}

export interface GeneratedPrompt {
  id: string; prompt: string; videoPrompt?: string;
}

export interface FailedChunk {
  chunkIndex: number; subtitles: Subtitle[]; error: string;
}

export interface ProcessingResult {
  prompts: GeneratedPrompt[];
  failedChunks: FailedChunk[];
}

// ============================================================
// Mythology Types
// ============================================================
export const MYTHOLOGY_STYLE = "Greek Mythology Dark Fantasy" as const;

export interface MythologyCharacter {
  name: string;
  internalId: string;
  sacredTier: number;
  depictionMethod: string;
  face: string;
  build: string;
  costume: string;
  signatureProps: string;
  fullDescription: string;
  condensedDescription: string;
}

export interface MythologySceneLocation {
  blockRange: string;
  location: string;
  timeOfDay: string;
  weather: string;
}

export interface MythologyColorGrade {
  sceneType: string;
  palette: string;
}

export interface MythologyContext {
  storySummary: string;
  storyOutline: Array<{ sceneNumber: number; blockRange: string; description: string }>;
  characters: MythologyCharacter[];
  sceneLocationMap: MythologySceneLocation[];
  colorGradingMap: MythologyColorGrade[];
  mythologyType: string;
  era: string;
  keyLocations: string[];
  keyConflicts: string[];
}

// ============================================================
// JSON Repair & Parsing
// ============================================================
function safeParseJSON(text: string): unknown {
  let cleaned = text.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '').trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');

  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const candidate = cleaned.substring(arrayStart, arrayEnd + 1);
    try { return JSON.parse(candidate); } catch { /* try repair */ }
    try { return JSON.parse(repairJSON(candidate)); } catch { /* fall through */ }
  }
  if (objStart !== -1 && objEnd > objStart) {
    const candidate = cleaned.substring(objStart, objEnd + 1);
    try { return JSON.parse(candidate); } catch { /* try repair */ }
    try { return JSON.parse(repairJSON(candidate)); } catch { /* fall through */ }
  }
  try { return JSON.parse(repairJSON(cleaned)); } catch { /* fall through */ }
  throw new Error("Could not parse JSON from model response.");
}

function repairJSON(text: string): string {
  let fixed = text;
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');
  fixed = fixed.replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, '\\n');
  fixed = fixed.replace(/[\x00-\x1F\x7F]/g, ch => (ch === '\n' || ch === '\r' || ch === '\t') ? ch : '');
  if (fixed.trimStart().startsWith('[') && !fixed.includes(']')) {
    const lb = fixed.lastIndexOf('}');
    if (lb !== -1) fixed = fixed.substring(0, lb + 1) + ']';
  }
  const lco = fixed.lastIndexOf('},');
  const lcb = fixed.lastIndexOf(']');
  if (lco !== -1 && lcb === -1) fixed = fixed.substring(0, lco + 1) + ']';
  try { JSON.parse(fixed); return fixed; } catch {
    const lgc = fixed.lastIndexOf('},');
    if (lgc !== -1) fixed = fixed.substring(0, lgc + 1) + ']';
  }
  return fixed;
}

// FIX 7: Full Script Sampling
function sampleScriptText(fullText: string, maxChars: number = 15000): string {
  if (fullText.length <= maxChars) return fullText;
  const third = Math.floor(maxChars / 3);
  const midStart = Math.floor(fullText.length / 2) - Math.floor(third / 2);
  return `[BEGINNING]\n${fullText.substring(0, third)}\n\n[MIDDLE]\n${fullText.substring(midStart, midStart + third)}\n\n[END]\n${fullText.substring(fullText.length - third)}`;
}

// ============================================================
// Error Helpers
// ============================================================
function getHttpStatus(err: unknown): number | null {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.httpStatusCode === 'number') return e.httpStatusCode;
    if (typeof e.code === 'number' && e.code >= 100 && e.code < 600) return e.code;
    const msg = String(e.message || '');
    const match = msg.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return parseInt(match[1]);
  }
  return null;
}

function isNetworkError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || '');
  return /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|fetch failed|network|socket/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Call with Fallback + Error Code Differentiation
// ============================================================
async function callWithFallback(
  client: GoogleGenAI,
  primaryModel: ModelId,
  contents: string,
  systemInstruction: string,
  thinkingMode: boolean,
  maxOutputTokens: number,
  onFallback?: (failedModel: string, nextModel: string, error: string) => void
): Promise<string> {
  const modelsToTry = [primaryModel, ...getFallbackModels(primaryModel)];

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    let retries = 0;
    const MAX_RETRIES_SAME_MODEL = 2; // Retry same model 2 times before switching (faster failure)

    while (retries < MAX_RETRIES_SAME_MODEL) {
      try {
        const thinkingConfig = thinkingMode
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } }
          : {};

        const response = await client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            maxOutputTokens,
            temperature: 0.7,
            ...thinkingConfig,
          }
        });

        if (!response.text) throw new Error("Empty response from model.");
        const text = response.text.trim();

        if (isResponseTruncated(text)) {
          console.warn(`Truncated response from "${model}" — attempting repair`);
        }

        return text;
      } catch (err: unknown) {
        const status = getHttpStatus(err);
        const errMsg = (err as { message?: string })?.message || String(err);

        // 400 Bad Request — prompt issue, no retry needed
        if (status === 400) throw new Error(`Bad request (400) on "${model}": ${errMsg}`);

        // 429 Rate Limit — wait longer, retry same model
        if (status === 429) {
          retries++;
          const waitSec = 3 + (retries * 2); // 5s, 7s, 9s
          console.warn(`Rate limited on "${model}" (retry ${retries}). Waiting ${waitSec}s...`);
          await sleep(waitSec * 1000);
          continue;
        }

        // 500/503 Server Error — wait 3s, retry SAME model first
        if (status === 500 || status === 503 || !status) {
          retries++;
          if (retries < MAX_RETRIES_SAME_MODEL) {
            const waitSec = 1 + retries; // 2s, 3s
            console.warn(`Server error on "${model}" (retry ${retries}/${MAX_RETRIES_SAME_MODEL}). Waiting ${waitSec}s...`);
            await sleep(waitSec * 1000);
            continue; // Retry SAME model
          }
          // All retries exhausted — fall through to next model
        }

        // Network error — retry with backoff
        if (isNetworkError(err)) {
          retries++;
          if (retries < MAX_RETRIES_SAME_MODEL) {
            await sleep(Math.pow(2, retries) * 1000);
            continue;
          }
        }

        // All retries for this model exhausted — switch to next model
        console.warn(`Model "${model}" failed after ${retries} retries (${status || 'unknown'})`);
        if (i < modelsToTry.length - 1) {
          onFallback?.(model, modelsToTry[i + 1], errMsg);
        } else {
          throw new Error(`All models failed. Last error (${model}): ${errMsg}`);
        }
        break; // Move to next model
      }
    }
  }
  throw new Error("All models failed.");
}

// ============================================================
// Global Context Analysis
// ============================================================
export async function analyzeGlobalContext(
  subtitles: Subtitle[],
  settings: GenerationSettings,
  onFallback?: (failedModel: string, nextModel: string, error: string) => void
): Promise<GlobalContext> {
  const clientInfo = keyPool.getNextClient();
  if (!clientInfo) throw new Error("All API keys are blacklisted. Please wait or add new keys.");
  await rateLimiter.waitForSlot(clientInfo.keyId);

  const fullText = subtitles.map(s => s.text).join(' ');
  const textToAnalyze = sampleScriptText(fullText, 15000);

  const isChalkboard = settings.style === CHALKBOARD_STYLE;
  const isMythology = settings.style === MYTHOLOGY_STYLE;
  const historyConfig = getHistoryStyleConfig(settings.style);

  // HISTORY STYLES WITH CHARACTER CARDS: Use mythology-style rich analysis
  if (historyConfig?.needsCharacterCards) {
    const histContents = `Analyze the following subtitles from a historical video and extract character details, locations, and visual context for generating consistent image prompts.

Subtitles:
${textToAnalyze}`;

    const histResponse = await callWithFallback(
      clientInfo.client, settings.selectedModel, histContents, MYTHOLOGY_CONTEXT_SYSTEM, settings.thinkingMode, 8192, onFallback
    );
    rateLimiter.recordTokenUsage(clientInfo.keyId, histContents + MYTHOLOGY_CONTEXT_SYSTEM, histResponse);
    keyPool.reportSuccess(clientInfo.keyId);

    const mythData = safeParseJSON(histResponse) as MythologyContext;
    return {
      era: mythData.era || settings.eraOverride,
      warType: mythData.keyConflicts?.join(', ') || 'Historical narrative',
      factions: mythData.characters?.map(c => c.name).join(', ') || '',
      environment: mythData.keyLocations?.join(', ') || '',
      tone: mythData.colorGradingMap?.[0]?.palette || 'Historical cinematic',
      keyElements: mythData.colorGradingMap?.map(c => c.sceneType).join(', ') || '',
      mythology: mythData,
    };
  }

  // MYTHOLOGY MODE: Separate rich analysis
  if (isMythology) {
    const mythContents = `Analyze the following subtitles from a mythology storytelling video. Extract ALL characters, locations, scenes, and color grading info.

Subtitles:
${textToAnalyze}`;

    const mythResponse = await callWithFallback(
      clientInfo.client, settings.selectedModel, mythContents, MYTHOLOGY_CONTEXT_SYSTEM, settings.thinkingMode, 8192, onFallback
    );
    rateLimiter.recordTokenUsage(clientInfo.keyId, mythContents + MYTHOLOGY_CONTEXT_SYSTEM, mythResponse);
    keyPool.reportSuccess(clientInfo.keyId);

    const mythData = safeParseJSON(mythResponse) as MythologyContext;

    return {
      era: mythData.era || settings.eraOverride,
      warType: mythData.keyConflicts?.join(', ') || 'Mythology narrative',
      factions: mythData.characters?.map(c => c.name).join(', ') || '',
      environment: mythData.keyLocations?.join(', ') || '',
      tone: 'Dark fantasy cinematic',
      keyElements: mythData.colorGradingMap?.map(c => c.sceneType).join(', ') || '',
      mythology: mythData,
    };
  }

  const contents = isChalkboard
    ? `Analyze the following subtitles from an educational/scientific video and extract the global context.

Return your response as a JSON object with exactly these keys: era, warType, factions, environment, tone, keyElements. All values must be strings. No extra text outside the JSON.
- "era" = the scientific domain (e.g., "Human Biology", "Quantum Physics", "Organic Chemistry")
- "warType" = the main topic or subject matter
- "factions" = key concepts, theories, or systems discussed
- "environment" = the educational setting or context
- "tone" = the overall tone (e.g., "Informative", "Cautionary", "Exploratory")
- "keyElements" = recurring scientific terms, formulas, or visual elements

Example format:
{"era": "Human Biology & Physiology", "warType": "Effects of sedentary lifestyle", "factions": "Cardiovascular system, Musculoskeletal system", "environment": "Medical education context", "tone": "Informative and cautionary", "keyElements": "Blood flow diagrams, heart rate graphs, anatomical cross-sections"}

Subtitles:
${textToAnalyze}`
    : `Analyze the following subtitles from a historical battle documentary and extract the global context.

Return your response as a JSON object with exactly these keys: era, warType, factions, environment, tone, keyElements. All values must be strings. No extra text outside the JSON.

Example format:
{"era": "...", "warType": "...", "factions": "...", "environment": "...", "tone": "...", "keyElements": "..."}

Subtitles:
${textToAnalyze}`;

  const sysInstr = isChalkboard
    ? CHALKBOARD_CONTEXT_SYSTEM
    : "You are a historical military expert. Analyze the text and extract the exact historical era, type of war/battle, involved factions/nations, general environment/terrain, overall tone, and key visual elements. Be concise and accurate. No fantasy elements. Always respond with valid JSON only, no markdown, no explanation.";

  const responseText = await callWithFallback(
    clientInfo.client, settings.selectedModel, contents, sysInstr, settings.thinkingMode, 2048, onFallback
  );
  rateLimiter.recordTokenUsage(clientInfo.keyId, contents + sysInstr, responseText);
  keyPool.reportSuccess(clientInfo.keyId);
  return safeParseJSON(responseText) as GlobalContext;
}

// ============================================================
// Prompt Generation for Single Chunk
// ============================================================
async function generateChunkWithClient(
  chunk: Subtitle[],
  globalContext: GlobalContext,
  settings: GenerationSettings,
  clientInfo: { client: GoogleGenAI; keyId: string },
  onFallback?: (failedModel: string, nextModel: string, error: string) => void
): Promise<GeneratedPrompt[]> {
  await rateLimiter.waitForSlot(clientInfo.keyId);

  const isChalkboard = settings.style === CHALKBOARD_STYLE;
  const isMythology = settings.style === MYTHOLOGY_STYLE;
  const isHistory = isHistoryStyle(settings.style);
  const eraToUse = settings.eraOverride !== 'Auto' ? settings.eraOverride : globalContext.era;

  let systemPrompt: string;

  if (isHistory) {
    // HISTORY STYLE MODE: Use style-specific system prompt
    const historyConfig = getHistoryStyleConfig(settings.style)!;
    const basePrompt = getHistorySystemPrompt(settings.style);

    // Inject global context
    const contextBlock = `
GLOBAL CONTEXT:
- Era: ${eraToUse}
- Topic: ${globalContext.warType}
- Key Figures: ${globalContext.factions}
- Environment: ${globalContext.environment}
- Tone: ${globalContext.tone}
- Key Elements: ${globalContext.keyElements}
${settings.consistencyLock ? '- Consistency Lock: Maintain strict visual consistency across all prompts.' : ''}
${settings.sacredProtocol ? '- Sacred Figure Protocol: ENABLED — Prophets depicted via Noor (golden divine light), face/body obscured.' : ''}`;

    // History 9: Add per-subtitle word counts to user prompt
    if (historyConfig.wordCountByDuration) {
      const subtitleInfo = chunk.map(s => {
        const wc = getWordCountByDuration(s);
        const dur = parseTimestampToSeconds(s.endTime) - parseTimestampToSeconds(s.startTime);
        return `ID: ${s.id}\nTimestamp: ${s.startTime} --> ${s.endTime}\nDuration: ${dur.toFixed(1)}s\nTarget words: ${wc}\nSubtitle: ${s.text}`;
      }).join('\n\n');

      systemPrompt = basePrompt + contextBlock;
      // Override chunkData and contents below via early return
      const h9Contents = `Generate exactly ${chunk.length} image prompts. Each prompt's word count MUST match the target words specified.
Return ONLY valid JSON with wordCount and duration fields.

Subtitles:

${subtitleInfo}`;

      const maxOut = calculateHistoryMaxOutput(settings.style, chunk.length);
      const MAX_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 1) await rateLimiter.waitForSlot(clientInfo.keyId);
        try {
          const responseText = await callWithFallback(clientInfo.client, settings.selectedModel, h9Contents, systemPrompt, settings.thinkingMode, maxOut, onFallback);
          const parsed = safeParseJSON(responseText) as GeneratedPrompt[];
          rateLimiter.recordTokenUsage(clientInfo.keyId, h9Contents + systemPrompt, responseText);
          keyPool.reportSuccess(clientInfo.keyId);
          return parsed;
        } catch (err: unknown) {
          const errMsg = (err as { message?: string })?.message || String(err);
          if ((errMsg.includes('JSON') || errMsg.includes('parse')) && attempt < MAX_RETRIES) continue;
          throw err;
        }
      }
      throw new Error("Failed after max retries.");
    }

    // FIX: Smart character card injection for History 3/4/5/8
    if (historyConfig.needsCharacterCards && globalContext.mythology?.characters?.length) {
      const myth = globalContext.mythology;
      // Detect which characters appear in this chunk
      const chunkText = chunk.map(s => s.text.toLowerCase()).join(' ');
      const activeChars = myth.characters.filter(c => {
        const nameParts = c.name.toLowerCase().split(/\s+/);
        return nameParts.some(part => part.length > 2 && chunkText.includes(part));
      });
      const charsToInject = activeChars.length > 0 ? activeChars : myth.characters;

      const characterCards = charsToInject.map(c =>
        `CHARACTER: ${c.name} [Tier ${c.sacredTier}]\nFull: ${c.fullDescription}\nCondensed: ${c.condensedDescription}`
      ).join('\n\n');

      const colorGrading = myth.colorGradingMap?.length
        ? '\nCOLOR GRADING MAP:\n' + myth.colorGradingMap.map(c => `${c.sceneType}: ${c.palette}`).join('\n')
        : '';

      systemPrompt = basePrompt + contextBlock + `

CHARACTER CARDS (USE EXACTLY — NO DEVIATION):
${characterCards}
${colorGrading}`;
    } else {
      systemPrompt = basePrompt + contextBlock;
    }
  } else if (isMythology && globalContext.mythology) {
    // MYTHOLOGY MODE: Full mythology system prompt with character cards
    systemPrompt = buildMythologyChunkPrompt(globalContext, settings, chunk);
  } else if (isChalkboard) {
    // CHALKBOARD MODE: Use dedicated chalkboard system prompt with context injection
    systemPrompt = CHALKBOARD_SYSTEM_PROMPT + `
GLOBAL CONTEXT:
- Scientific Domain: ${eraToUse}
- Topic: ${globalContext.warType}
- Key Concepts: ${globalContext.factions}
- Context: ${globalContext.environment}
- Tone: ${globalContext.tone}
- Recurring Elements: ${globalContext.keyElements}
${settings.consistencyLock ? `- Consistency Lock: Maintain consistent chalk style, diagram layout conventions, and terminology across all prompts.` : ''}
${settings.enhancementToggle ? `- Enhancement: ULTRA-DETAILED MODE — Include exhaustive scientific detail: exact numerical values, complete formula derivations, detailed anatomical labels, and mechanism pathway arrows.` : ''}
`;
  } else {
    // STANDARD BATTLE MODE: Original system prompt
    let styleInstruction = "";
    switch (settings.style) {
      case "Cinematic Realism": styleInstruction = "Cinematic lighting, photorealistic, 8k resolution, highly detailed, shot on 35mm lens, dramatic shadows."; break;
      case "Old Oil Painting": styleInstruction = "Renaissance oil painting style, visible brush strokes, chiaroscuro lighting, classical composition, museum quality."; break;
      case "2D Comic Novel Style": styleInstruction = "Graphic novel style, bold ink lines, dramatic shading, muted color palette, dynamic comic book composition."; break;
      case "Dark War Documentary Style": styleInstruction = "Gritty war documentary style, monochromatic or desaturated colors, high contrast, film grain, raw and visceral."; break;
      case "Vintage Historical Illustration": styleInstruction = "Vintage historical book illustration, etching style, sepia tones, intricate line work, archival quality."; break;
      default: styleInstruction = "Cinematic realism.";
    }

    systemPrompt = `You are an expert AI image prompt engineer and cinematic visual director specializing in historically accurate scenes.
Your task is to convert subtitle text into standalone, highly detailed, Nano Banana-optimized image generation prompts.

GLOBAL CONTEXT:
- Era: ${eraToUse}
- War Type: ${globalContext.warType}
- Factions: ${globalContext.factions}
- Environment: ${globalContext.environment}
- Tone: ${globalContext.tone}
${settings.consistencyLock ? `- Consistency Lock: Maintain strict visual consistency for the factions, uniforms, and environment mentioned above.` : ''}
${settings.sacredProtocol ? `- Sacred Figure Protocol: ENABLED — Tier 1 Prophets shown as golden Noor silhouette only (no face/body). Tier 2 Angels as abstract luminous forms. Tier 3 Antagonists depictable with dignity. Tier 4 Others fully depictable.` : ''}

LOCKED VISUAL STYLE: ${styleInstruction}
- Scene Intensity: ${settings.sceneIntensity}
- Enhancement: ${settings.enhancementToggle ? 'ULTRA-DETAILED MODE: Include exhaustive details about fabric textures, dirt, sweat, lighting nuances, and atmospheric effects.' : 'Standard detail.'}

${NANO_BANANA_RULES}

${PROMPT_LENGTH_INSTRUCTION}

STRICT RULES:
1. Create EXACTLY ONE image prompt per subtitle provided.
2. Each prompt MUST be a FLOWING NARRATIVE PARAGRAPH — not a keyword list.
3. Include specific historical details with MATERIALITY (specific metals, fabrics, textures).
4. Include CHARACTER EXPRESSION and BODY LANGUAGE matching the subtitle's emotional context.
5. Include CAMERA/LENS specification (focal length, aperture, DOF).
6. Include EMOTIONAL LIGHTING matching the scene mood.
7. ALWAYS respond with a valid JSON array only. No markdown, no explanation, no extra text.
`;
  }

  const chunkData = chunk.map(s => `ID: ${s.id}\nTimestamp: ${s.startTime} --> ${s.endTime}\nSubtitle: ${s.text}`).join('\n\n');

  const exampleFormat = isMythology && settings.veoEnabled
    ? `[{"id": "1", "prompt": "A detailed scene of...", "videoPrompt": "Slow push-in on..."}, ...]`
    : `[{"id": "1", "prompt": "A detailed scene of..."}, {"id": "2", "prompt": "..."}]`;

  const wordRange = isMythology ? `${PROMPT_CONFIG.MIN_WORDS}-280` : `${PROMPT_CONFIG.MIN_WORDS}-${PROMPT_CONFIG.MAX_WORDS}`;

  // AGGRESSIVE MODE: When only 1 subtitle, emphasize that model MUST return it
  const singleSubtitleMode = chunk.length === 1;
  const aggressiveHeader = singleSubtitleMode
    ? `CRITICAL: You MUST generate a prompt for the subtitle with ID "${chunk[0].id}". Do NOT skip it. Do NOT return an empty array. Return exactly 1 prompt with id "${chunk[0].id}".\n\n`
    : '';

  const contents = `${aggressiveHeader}Generate exactly ${chunk.length} image prompt${chunk.length > 1 ? 's' : ''} (one per subtitle). Each prompt MUST be ${wordRange} words.${isMythology && settings.veoEnabled ? ' Also generate a videoPrompt for each.' : ''}
Return ONLY a valid JSON array. No markdown, no explanation.

Example format:
${exampleFormat}

Subtitles:

${chunkData}${singleSubtitleMode ? `\n\nREMINDER: Return exactly 1 prompt with id "${chunk[0].id}" — do not skip this.` : ''}`;

  // MODULE 3: Calculate maxOutputTokens for this chunk
  const maxOutputTokens = isMythology
    ? calculateMythologyMaxOutput(chunk.length, settings.veoEnabled)
    : isHistory
      ? calculateHistoryMaxOutput(settings.style, chunk.length)
      : calculateMaxOutputTokens(chunk.length);

  const MAX_RETRIES = 2; // Reduced from 3 — faster failure, outer auto-retry handles it
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) await rateLimiter.waitForSlot(clientInfo.keyId);
    try {
      const responseText = await callWithFallback(
        clientInfo.client, settings.selectedModel, contents, systemPrompt, settings.thinkingMode, maxOutputTokens, onFallback
      );
      let parsed = safeParseJSON(responseText) as GeneratedPrompt[];

      // MODULE 1+5: Validate and trim prompt lengths
      parsed = parsed.map(p => ({
        ...p,
        prompt: trimPromptToMaxWords(p.prompt)
      }));

      rateLimiter.recordTokenUsage(clientInfo.keyId, contents + systemPrompt, responseText);
      keyPool.reportSuccess(clientInfo.keyId);
      return parsed;
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || String(err);
      const isJsonError = errMsg.includes('JSON') || errMsg.includes('parse');
      // MODULE 4: On token/length error, try with smaller chunk
      const isTokenError = errMsg.includes('token') || errMsg.includes('length') || errMsg.includes('too long');

      if (isTokenError && chunk.length > 1) {
        // Auto-split: process half at a time
        const half = Math.ceil(chunk.length / 2);
        const first = await generateChunkWithClient(chunk.slice(0, half), globalContext, settings, clientInfo, onFallback);
        await rateLimiter.waitForSlot(clientInfo.keyId);
        const second = await generateChunkWithClient(chunk.slice(half), globalContext, settings, clientInfo, onFallback);
        return [...first, ...second];
      }

      if (isJsonError && attempt < MAX_RETRIES) {
        console.warn(`JSON parse failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed after max retries.");
}

// ============================================================
// Task Queue Processing
// ============================================================
export async function processAllChunks(
  subtitles: Subtitle[],
  globalContext: GlobalContext,
  settings: GenerationSettings,
  chunkSize: number,
  onProgress: (prompts: GeneratedPrompt[], processedCount: number, total: number, status: string) => void,
  onFallback?: (failedModel: string, nextModel: string, error: string) => void
): Promise<ProcessingResult> {
  const chunks: Array<{ index: number; subtitles: Subtitle[] }> = [];
  for (let i = 0; i < subtitles.length; i += chunkSize) {
    chunks.push({ index: chunks.length, subtitles: subtitles.slice(i, i + chunkSize) });
  }

  const total = subtitles.length;
  const allPrompts: GeneratedPrompt[] = [];
  const failedChunks: FailedChunk[] = [];
  let nextChunkIdx = 0;
  let processedCount = 0;

  // SPEED: Worker dynamically picks least-recently-used healthy key (not bound to keyIndex)
  async function worker(workerId: number) {
    while (true) {
      const ci = nextChunkIdx;
      if (ci >= chunks.length) break;
      nextChunkIdx++;

      const chunk = chunks[ci];
      // Dynamic key selection — LRU healthy key
      const activeClient = keyPool.getNextClient();
      if (!activeClient) {
        failedChunks.push({ chunkIndex: ci, subtitles: chunk.subtitles, error: 'All API keys blacklisted' });
        processedCount += chunk.subtitles.length;
        onProgress([...allPrompts], processedCount, total, `Chunk ${ci + 1} failed (all keys down)`);
        continue;
      }

      try {
        const prompts = await generateChunkWithClient(chunk.subtitles, globalContext, settings, activeClient, onFallback);
        allPrompts.push(...prompts);
        keyPool.reportSuccess(activeClient.keyId);
      } catch (err: unknown) {
        keyPool.reportFailure(activeClient.keyId);
        const errMsg = (err as { message?: string })?.message || String(err);
        failedChunks.push({ chunkIndex: ci, subtitles: chunk.subtitles, error: errMsg });
      }

      processedCount += chunk.subtitles.length;
      const sorted = [...allPrompts].sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
      const failedCount = failedChunks.length;
      const statusMsg = failedCount > 0
        ? `Processing... ${sorted.length} prompts generated (${failedCount} chunk${failedCount > 1 ? 's' : ''} retrying)`
        : `Processing... ${sorted.length} prompts generated`;
      onProgress(sorted, processedCount, total, statusMsg);
    }
  }

  // SPEED: 2 workers per key = 2x parallelism (Google API handles concurrent requests per key fine)
  const workersPerKey = 2;
  const totalWorkers = Math.max(1, keyPool.getKeyCount() * workersPerKey);
  await Promise.all(Array.from({ length: totalWorkers }, (_, i) => worker(i)));

  allPrompts.sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
  return { prompts: allPrompts, failedChunks };
}

// Retry only the failed chunks
// Retry with parallel task queue (same as main processing)
export async function retryFailedChunks(
  failedChunks: FailedChunk[],
  globalContext: GlobalContext,
  settings: GenerationSettings,
  onProgress: (prompts: GeneratedPrompt[], processedCount: number, total: number, status: string) => void,
  onFallback?: (failedModel: string, nextModel: string, error: string) => void
): Promise<ProcessingResult> {
  const total = failedChunks.reduce((s, fc) => s + fc.subtitles.length, 0);
  const allPrompts: GeneratedPrompt[] = [];
  const stillFailed: FailedChunk[] = [];
  let nextIdx = 0;
  let processedCount = 0;

  // Parallel worker — dynamic key selection (LRU healthy)
  async function worker(_workerId: number) {
    while (true) {
      const ci = nextIdx;
      if (ci >= failedChunks.length) break;
      nextIdx++;

      const fc = failedChunks[ci];
      const activeClient = keyPool.getNextClient();
      if (!activeClient) {
        stillFailed.push({ ...fc, error: 'All API keys blacklisted' });
        processedCount += fc.subtitles.length;
        onProgress([...allPrompts], processedCount, total, `Recovery paused (keys cooling down)`);
        continue;
      }

      try {
        const prompts = await generateChunkWithClient(fc.subtitles, globalContext, settings, activeClient, onFallback);
        allPrompts.push(...prompts);
        keyPool.reportSuccess(activeClient.keyId);
      } catch (err: unknown) {
        keyPool.reportFailure(activeClient.keyId);
        stillFailed.push({ chunkIndex: fc.chunkIndex, subtitles: fc.subtitles, error: (err as { message?: string })?.message || String(err) });
      }

      processedCount += fc.subtitles.length;
      const sorted = [...allPrompts].sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
      onProgress(sorted, processedCount, total, `Retrying... ${allPrompts.length} recovered`);
    }
  }

  // 2 workers per key for 2x parallel recovery
  const workersPerKey = 2;
  const totalWorkers = Math.max(1, keyPool.getKeyCount() * workersPerKey);
  await Promise.all(Array.from({ length: totalWorkers }, (_, i) => worker(i)));

  allPrompts.sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
  return { prompts: allPrompts, failedChunks: stillFailed };
}
