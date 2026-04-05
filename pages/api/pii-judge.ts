/**
 * LLM-as-Judge guardrail for memories.ai requests.
 *
 * Blocks prompts that attempt to extract PII about video creators:
 * name, gender, nationality, race, ethnicity, religion, age,
 * address, phone number, email, and related attributes.
 *
 * Works on both initial questions and follow-up messages in a
 * conversation — even if the follow-up is phrased indirectly.
 */

export interface JudgeVerdict {
  allowed: boolean
  reason: string
  category?: string
}

const PII_CATEGORIES: Record<string, RegExp[]> = {
  name: [
    /\b(?:who\s+(?:is|are|was|made|created|produced|directed|filmed|uploaded|posted|recorded))\b/i,
    /\b(?:(?:what(?:'s| is| are))\s+(?:the\s+)?(?:name|identity|creator|author|uploader|poster|person|owner|producer|director|filmmaker))\b/i,
    /\b(?:(?:tell|give|share|reveal|disclose|provide)\s+(?:me\s+)?(?:the\s+)?(?:name|identity))\b/i,
    /\b(?:name\s+of\s+(?:the\s+)?(?:person|creator|author|uploader|poster|user|owner|producer|director|filmmaker))\b/i,
    /\b(?:(?:real|full|actual|legal|first|last|sur)\s*name)\b/i,
    /\b(?:identify\s+(?:the\s+)?(?:person|individual|creator|user))\b/i,
    /\bdo(?:x+|xx)(?:ing)?\b/i,
  ],
  gender: [
    /\b(?:(?:what(?:'s| is))\s+(?:the\s+)?(?:their|his|her|the\s+(?:creator|person|user)(?:'s)?)\s*gender)\b/i,
    /\b(?:(?:is\s+(?:the\s+)?(?:person|creator|user|uploader)\s+(?:a\s+)?(?:male|female|man|woman|boy|girl|non[- ]?binary)))\b/i,
    /\b(?:gender\s+(?:of|identity))\b/i,
    /\b(?:(?:are\s+they|is\s+(?:he|she))\s+(?:male|female|trans))\b/i,
    /\b(?:what\s+(?:pronouns?|sex))\b/i,
  ],
  nationality: [
    /\b(?:(?:what(?:'s| is))\s+(?:the\s+)?(?:their|his|her|the\s+(?:creator|person|user)(?:'s)?)\s*(?:nationality|citizenship|country|homeland|passport))\b/i,
    /\b(?:(?:where\s+(?:is|are)\s+(?:they|he|she|the\s+(?:person|creator|user)))\s+(?:from|born|based|living|located))\b/i,
    /\b(?:nationality\s+of)\b/i,
    /\b(?:which\s+country\s+(?:is|are|does))\b/i,
    /\b(?:(?:are\s+they|is\s+(?:he|she))\s+(?:indian|american|chinese|british|japanese|korean|african|european|asian|mexican|canadian|australian|russian|french|german|italian|brazilian|pakistani|bangladeshi|arab|middle\s*eastern|latin|latino|latina|hispanic))\b/i,
  ],
  race_ethnicity: [
    /\b(?:(?:what(?:'s| is))\s+(?:the\s+)?(?:their|his|her|the\s+(?:creator|person|user)(?:'s)?)\s*(?:race|ethnicity|ethnic\s+(?:background|origin|group)|racial\s+(?:background|identity)))\b/i,
    /\b(?:race\s+of)\b/i,
    /\b(?:ethnicity\s+of)\b/i,
    /\b(?:(?:are\s+they|is\s+(?:he|she))\s+(?:white|black|brown|asian|caucasian|hispanic|latino|latina|african[- ]?american|native|indigenous))\b/i,
    /\b(?:skin\s*(?:color|colour|tone))\b/i,
  ],
  religion: [
    /\b(?:(?:what(?:'s| is))\s+(?:the\s+)?(?:their|his|her|the\s+(?:creator|person|user)(?:'s)?)\s*(?:religion|faith|belief|worship|denomination|sect))\b/i,
    /\b(?:religion\s+of)\b/i,
    /\b(?:(?:are\s+they|is\s+(?:he|she))\s+(?:hindu|muslim|christian|jewish|sikh|buddhist|jain|catholic|protestant|atheist|agnostic))\b/i,
  ],
  age: [
    /\b(?:(?:how\s+old)\s+(?:is|are)\s+(?:the\s+)?(?:person|creator|user|uploader|he|she|they))\b/i,
    /\b(?:(?:what(?:'s| is))\s+(?:the\s+)?(?:their|his|her|the\s+(?:creator|person|user)(?:'s)?)\s*(?:age|date\s+of\s+birth|birthday|birth\s*date|dob))\b/i,
    /\b(?:age\s+of\s+(?:the\s+)?(?:person|creator|user))\b/i,
  ],
  contact_info: [
    /\b(?:(?:what(?:'s| is))\s+(?:the\s+)?(?:their|his|her|the\s+(?:creator|person|user)(?:'s)?)\s*(?:email|phone|address|contact|number|location|social\s*media|instagram|twitter|facebook|linkedin|snapchat|tiktok))\b/i,
    /\b(?:(?:phone|email|home)\s+(?:number|address|id)\s+of)\b/i,
    /\b(?:(?:how\s+(?:can\s+i|to|do\s+i))\s+(?:contact|reach|find|locate|message|dm|call))\b/i,
    /\b(?:(?:where\s+(?:does|do))\s+(?:they|he|she)\s+live)\b/i,
  ],
  personal_identity: [
    /\b(?:(?:what(?:'s| is))\s+(?:the\s+)?(?:their|his|her|the\s+(?:creator|person|user)(?:'s)?)\s*(?:caste|marital\s+status|sexual\s+orientation|political\s+(?:affiliation|party|leaning)|income|salary|social\s+security|ssn|aadhaar|pan\s+(?:card|number)))\b/i,
    /\b(?:(?:are\s+they|is\s+(?:he|she))\s+(?:married|single|divorced|gay|straight|lesbian|bisexual|queer))\b/i,
  ],
}

const INDIRECT_PII_PATTERNS: RegExp[] = [
  /\b(?:tell\s+(?:me\s+)?(?:about|more\s+about)\s+(?:the\s+)?(?:person|creator|uploader|author|user|owner|poster|filmmaker|director|producer)\s+(?:behind|who|in))\b/i,
  /\b(?:(?:personal|private|identifying|demographic)\s+(?:info|information|details|data)\s+(?:about|of|on))\b/i,
  /\b(?:(?:can\s+you|please)\s+(?:identify|unmask|expose|reveal|find\s+out))\b/i,
  /\b(?:(?:everything|anything)\s+(?:about|on)\s+(?:the\s+)?(?:person|creator|uploader|user))\b/i,
  /\b(?:(?:who\s+(?:is\s+)?(?:this|that)\s+(?:person|guy|girl|man|woman|creator|user)))\b/i,
  /\b(?:(?:what\s+(?:do\s+)?(?:you|we)\s+know\s+about)\s+(?:the\s+)?(?:person|creator|user|uploader))\b/i,
]

const FOLLOW_UP_PII_PATTERNS: RegExp[] = [
  /\b(?:(?:and|also|what\s+about)\s+(?:their|his|her)\s+(?:name|gender|race|ethnicity|nationality|religion|age|email|phone|address|contact|caste|identity))\b/i,
  /\b(?:(?:you\s+didn'?t\s+(?:answer|tell|say))\s+(?:me\s+)?(?:their|his|her|the)\s+(?:name|gender|race|identity))\b/i,
  /\b(?:(?:i\s+(?:asked|want|need)\s+(?:to\s+know\s+)?(?:their|his|her|the)\s+(?:name|gender|race|identity)))\b/i,
  /\b(?:(?:just\s+tell\s+me|come\s+on|please)\s+(?:the\s+)?(?:name|gender|race|nationality|identity))\b/i,
  /\b(?:(?:but|so)\s+who\s+(?:is|are)\s+(?:they|he|she|the\s+(?:person|creator)))\b/i,
  /\b(?:forget\s+(?:the\s+)?(?:rules?|restrictions?|policy|policies)\s+(?:and\s+)?(?:tell|give|answer|share))\b/i,
  /\b(?:ignore\s+(?:the\s+)?(?:previous|above|last)\s+(?:instructions?|rules?|restrictions?))\b/i,
  /\b(?:pretend\s+(?:you\s+)?(?:are|'re)\s+(?:not\s+)?(?:restricted|limited|filtered))\b/i,
]

function normalizeText(text: string): string {
  return text
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function judgePiiRequest(prompt: string, conversationHistory?: string[]): JudgeVerdict {
  const normalized = normalizeText(prompt)

  for (const [category, patterns] of Object.entries(PII_CATEGORIES)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return {
          allowed: false,
          reason: `This question seeks personally identifiable information (${category.replace(/_/g, ' ')}) about the creator. I can only help with questions about the video content itself.`,
          category,
        }
      }
    }
  }

  for (const pattern of INDIRECT_PII_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        allowed: false,
        reason: 'This question seeks personal information about the creator. I can only help with questions about the video content itself.',
        category: 'indirect_pii',
      }
    }
  }

  for (const pattern of FOLLOW_UP_PII_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        allowed: false,
        reason: 'This follow-up still seeks personally identifiable information. I can only help with questions about the video content — like what happens in the video, its themes, or suggestions for captions and hashtags.',
        category: 'follow_up_pii',
      }
    }
  }

  if (conversationHistory && conversationHistory.length > 0) {
    const contextualPii = checkContextualPii(normalized, conversationHistory)
    if (contextualPii) return contextualPii
  }

  return { allowed: true, reason: 'Prompt is safe.' }
}

function checkContextualPii(prompt: string, history: string[]): JudgeVerdict | null {
  const recentRejection = history.some((msg) =>
    msg.includes('personally identifiable information') ||
    msg.includes('personal information about the creator')
  )

  if (!recentRejection) return null

  const evasionPatterns = [
    /\b(?:(?:ok|okay|fine|alright)\s+(?:then\s+)?(?:just\s+)?(?:tell|answer|give|share))\b/i,
    /\b(?:(?:try|let'?s\s+try)\s+(?:again|differently|another\s+way))\b/i,
    /\b(?:(?:hint|clue|guess)\s+(?:about|at)?\s*(?:who|their|the\s+(?:person|creator)))\b/i,
    /\b(?:(?:same\s+question|again|repeat|rephrase))\b/i,
    /\b(?:(?:what\s+if\s+i)\s+(?:ask|say|rephrase))\b/i,
  ]

  const pronoun_with_pii = [
    /\b(?:(?:their|his|her)\s+(?:real\s+)?(?:name|identity|background|info))\b/i,
    /\b(?:(?:about|regarding)\s+(?:them|him|her)\s+(?:personally|specifically))\b/i,
  ]

  for (const pattern of [...evasionPatterns, ...pronoun_with_pii]) {
    if (pattern.test(prompt)) {
      return {
        allowed: false,
        reason: 'I understand you\'d like more information, but I\'m unable to share personal details about the creator. Feel free to ask anything about the video content — I\'m happy to help with that!',
        category: 'evasion_attempt',
      }
    }
  }

  return null
}
