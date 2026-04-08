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
  "History 1 — 2D Animated": { id: "history_1", label: "History 1 — 2D Animated (Fire Accents)", description: "Hand-drawn 2D animation style. Cool slate blue + warm fire accents. Best for: Animated history explainers.", chunkSize: 8, targetWords: 220, temperature: 0.7, needsCharacterCards: false, needsSacredProtocol: false, autoColorBW: false, wordCountByDuration: false },
  "History 2 — Sepia Story": { id: "history_2", label: "History 2 — Sepia Story-Illustration", description: "Sepia-toned 2D story-illustration with bold ink outlines. Auto-adapts to any culture/era. Best for: Universal historical storytelling.", chunkSize: 8, targetWords: 220, temperature: 0.7, needsCharacterCards: false, needsSacredProtocol: false, autoColorBW: false, wordCountByDuration: false },
  "History 3 — Epic Cinematic": { id: "history_3", label: "History 3 — Epic Cinematic Matte", description: "Painterly cinematic concept art. Grand historical film frames. Best for: Historical epics, battle documentaries.", chunkSize: 7, targetWords: 250, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: false, autoColorBW: false, wordCountByDuration: false },
  "History 4 — Celestial Fantasy": { id: "history_4", label: "History 4 — Celestial Fantasy Panoramic [Sacred]", description: "Epic celestial fantasy matte painting. Panoramic mythic worldbuilding. Sacred Figure Protocol available. Best for: Ancient empires, prophecy, sacred/Islamic history.", chunkSize: 7, targetWords: 260, temperature: 0.75, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 5 — Romantic Oil": { id: "history_5", label: "History 5 — Romantic Oil-Painting", description: "Old-master inspired romantic oil-painting. Museum-quality. Best for: Royal history, devotional, maritime, Renaissance.", chunkSize: 7, targetWords: 250, temperature: 0.7, needsCharacterCards: true, needsSacredProtocol: false, autoColorBW: false, wordCountByDuration: false },
  "History 6 — Museum Parchment": { id: "history_6", label: "History 6 — Museum Artifact Parchment", description: "Oil on aged parchment with craquelure. Like a scanned museum artifact. Best for: Ancient civilizations (Mongol, Roman, Persian).", chunkSize: 8, targetWords: 200, temperature: 0.7, needsCharacterCards: false, needsSacredProtocol: false, autoColorBW: false, wordCountByDuration: false },
  "History 7 — Documentary Auto": { id: "history_7", label: "History 7 — Documentary Auto Color/B&W", description: "Auto-decides Color or B&W per scene based on tone. Best for: Biography, modern history documentaries.", chunkSize: 8, targetWords: 200, temperature: 0.7, needsCharacterCards: false, needsSacredProtocol: false, autoColorBW: true, wordCountByDuration: false },
  "History 8 — Impasto Oil": { id: "history_8", label: "History 8 — Impasto Oil Magical Realism [Sacred]", description: "Thick impasto oil painting with swirling brushstrokes. Dramatic chiaroscuro + magical realism. Sacred Figure Protocol (Noor) built-in. Best for: Islamic/Egyptian history.", chunkSize: 7, targetWords: 240, temperature: 0.75, needsCharacterCards: true, needsSacredProtocol: true, autoColorBW: false, wordCountByDuration: false },
  "History 9 — Ancient Fresco": { id: "history_9", label: "History 9 — Ancient Fresco Relief", description: "Ancient fresco / carved relief. Midnight blues + muted gold. Word count varies by duration. Best for: Sleep/calm mythology.", chunkSize: 10, targetWords: 36, temperature: 0.65, needsCharacterCards: false, needsSacredProtocol: false, autoColorBW: false, wordCountByDuration: true },
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
};

function getHistorySystemPrompt(style: string): string {
  return HISTORY_SYSTEM_PROMPTS[style] || '';
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
  // Use the smaller, capped at 5 for extra safety
  const chunkSize = Math.min(maxByTokens, maxByReliability, 5);

  const totalChunks = Math.ceil(totalSubtitles / chunkSize);
  const tokensPerChunk = (INPUT_PER_SUBTITLE * chunkSize) + SYSTEM_PROMPT_TOKENS + (OUTPUT_PER_PROMPT * chunkSize);

  // Time estimate: ~1 call per 5 seconds per key
  const effectiveKeys = Math.max(1, numApiKeys);
  const totalSeconds = Math.ceil((totalChunks / effectiveKeys) * 5);
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
  private static INTER_REQUEST_DELAY_MS = 4800; // ~12.5 RPM

  constructor(maxRpm: number = 13, maxTpm: number = 230_000) {
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
    let rateLimitRetries = 0;

    while (true) {
      try {
        const thinkingConfig = thinkingMode
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } }
          : {};

        // MODULE 3: Include maxOutputTokens in config
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

        // MODULE 5: Check for truncated response
        if (isResponseTruncated(text)) {
          console.warn(`Truncated response from "${model}" — attempting repair`);
          // Still return it — safeParseJSON can handle partial JSON
        }

        return text;
      } catch (err: unknown) {
        const status = getHttpStatus(err);
        const errMsg = (err as { message?: string })?.message || String(err);

        // 429 Rate Limit — wait and retry SAME model
        if (status === 429 && rateLimitRetries < 2) {
          rateLimitRetries++;
          console.warn(`Rate limited on "${model}" (attempt ${rateLimitRetries}). Waiting 5s...`);
          await sleep(5000);
          continue;
        }

        // 400 Bad Request — prompt issue
        if (status === 400) throw new Error(`Bad request (400) on "${model}": ${errMsg}`);

        // Network error — exponential backoff
        if (isNetworkError(err)) {
          let recovered = false;
          for (let retry = 0; retry < 3; retry++) {
            await sleep(Math.pow(2, retry) * 1000);
            try {
              const tc = thinkingMode ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {};
              const r = await client.models.generateContent({
                model, contents, config: { systemInstruction, maxOutputTokens, temperature: 0.7, ...tc }
              });
              if (r.text) { recovered = true; return r.text.trim(); }
            } catch { /* continue */ }
          }
          if (!recovered) console.warn(`Network error on "${model}" after retries`);
        }

        console.warn(`Model "${model}" failed (${status || 'unknown'}): ${errMsg}`);
        if (i < modelsToTry.length - 1) {
          onFallback?.(model, modelsToTry[i + 1], errMsg);
        } else {
          throw new Error(`All models failed. Last error (${model}): ${errMsg}`);
        }
        break;
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

    systemPrompt = `You are an expert AI image prompt engineer specializing in historically accurate military and battle scenes.
Your task is to convert a sequence of subtitles into standalone, highly detailed image generation prompts.

GLOBAL CONTEXT:
- Era: ${eraToUse}
- War Type: ${globalContext.warType}
- Factions: ${globalContext.factions}
- Environment: ${globalContext.environment}
- Tone: ${globalContext.tone}
${settings.consistencyLock ? `- Consistency Lock: Maintain strict visual consistency for the factions, uniforms, and environment mentioned above.` : ''}

SETTINGS:
- Visual Style: ${styleInstruction}
- Scene Intensity: ${settings.sceneIntensity}
- Camera Angles: ${settings.cameraAngleVariation ? 'Vary camera angles (wide shots, close-ups, aerials) dynamically based on the action.' : 'Standard eye-level documentary composition.'}
- Enhancement: ${settings.enhancementToggle ? 'ULTRA-DETAILED MODE: Include exhaustive details about fabric textures, dirt, sweat, lighting nuances, and atmospheric effects.' : 'Standard detail.'}

${PROMPT_LENGTH_INSTRUCTION}

STRICT RULES:
1. Create EXACTLY ONE image prompt per subtitle provided.
2. Each prompt MUST be completely self-contained. Do not reference "the previous image" or use pronouns without context.
3. Include specific historical details (accurate weapons, armor, clothing).
4. NO fantasy, NO magic, NO futuristic elements. Realistic historical depiction only.
5. Describe Who, What, Where, and Visual Style in every prompt.
6. ALWAYS respond with a valid JSON array only. No markdown, no explanation, no extra text.
`;
  }

  const chunkData = chunk.map(s => `ID: ${s.id}\nTimestamp: ${s.startTime} --> ${s.endTime}\nSubtitle: ${s.text}`).join('\n\n');

  const exampleFormat = isMythology && settings.veoEnabled
    ? `[{"id": "1", "prompt": "A detailed scene of...", "videoPrompt": "Slow push-in on..."}, ...]`
    : `[{"id": "1", "prompt": "A detailed scene of..."}, {"id": "2", "prompt": "..."}]`;

  const wordRange = isMythology ? `${PROMPT_CONFIG.MIN_WORDS}-280` : `${PROMPT_CONFIG.MIN_WORDS}-${PROMPT_CONFIG.MAX_WORDS}`;
  const contents = `Generate exactly ${chunk.length} image prompts (one per subtitle). Each prompt MUST be ${wordRange} words.${isMythology && settings.veoEnabled ? ' Also generate a videoPrompt for each.' : ''}
Return ONLY a valid JSON array. No markdown, no explanation.

Example format:
${exampleFormat}

Subtitles:

${chunkData}`;

  // MODULE 3: Calculate maxOutputTokens for this chunk
  const maxOutputTokens = isMythology
    ? calculateMythologyMaxOutput(chunk.length, settings.veoEnabled)
    : isHistory
      ? calculateHistoryMaxOutput(settings.style, chunk.length)
      : calculateMaxOutputTokens(chunk.length);

  const MAX_RETRIES = 3;
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

  async function worker(keyIndex: number) {
    while (true) {
      const ci = nextChunkIdx;
      if (ci >= chunks.length) break;
      nextChunkIdx++;

      const chunk = chunks[ci];
      const clientInfo = keyPool.getClientByIndex(keyIndex);

      let activeClient = clientInfo;
      if (keyPool.isBlacklisted(clientInfo.keyId)) {
        const alt = keyPool.getNextClient();
        if (!alt) {
          failedChunks.push({ chunkIndex: ci, subtitles: chunk.subtitles, error: 'All API keys blacklisted' });
          processedCount += chunk.subtitles.length;
          onProgress([...allPrompts], processedCount, total, `Chunk ${ci + 1} failed (all keys down)`);
          continue;
        }
        activeClient = alt;
      }

      try {
        const prompts = await generateChunkWithClient(chunk.subtitles, globalContext, settings, activeClient, onFallback);
        allPrompts.push(...prompts);
      } catch (err: unknown) {
        keyPool.reportFailure(activeClient.keyId);
        const errMsg = (err as { message?: string })?.message || String(err);
        failedChunks.push({ chunkIndex: ci, subtitles: chunk.subtitles, error: errMsg });
      }

      processedCount += chunk.subtitles.length;
      onProgress([...allPrompts], processedCount, total, `Processing... ${allPrompts.length} prompts generated`);
    }
  }

  const workerCount = Math.max(1, keyPool.getKeyCount());
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i)));

  allPrompts.sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
  return { prompts: allPrompts, failedChunks };
}

// Retry only the failed chunks
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
  let processedCount = 0;

  for (const fc of failedChunks) {
    const clientInfo = keyPool.getNextClient();
    if (!clientInfo) {
      stillFailed.push({ ...fc, error: 'All API keys blacklisted' });
      processedCount += fc.subtitles.length;
      onProgress([...allPrompts], processedCount, total, `Retry failed (no healthy keys)`);
      continue;
    }
    try {
      const prompts = await generateChunkWithClient(fc.subtitles, globalContext, settings, clientInfo, onFallback);
      allPrompts.push(...prompts);
    } catch (err: unknown) {
      keyPool.reportFailure(clientInfo.keyId);
      stillFailed.push({ chunkIndex: fc.chunkIndex, subtitles: fc.subtitles, error: (err as { message?: string })?.message || String(err) });
    }
    processedCount += fc.subtitles.length;
    onProgress([...allPrompts], processedCount, total, `Retrying... ${allPrompts.length} recovered`);
  }

  allPrompts.sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
  return { prompts: allPrompts, failedChunks: stillFailed };
}
