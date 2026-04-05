# InstaAI
InstaAI is an integrated, multi-modal assistant that allows users to interact with Instagram Reels in real-time. By analyzing video content (visuals, audio, and captions), InstaAI provides immediate, contextual answers to user queries, reducing the need for users to leave the app to search for details like recipes, locations, or product specs.


# 1. Product Vision

InstaAI is an integrated, multi-modal assistant that allows users to interact with Instagram Reels in real-time. By analyzing video content (visuals, audio, and captions), InstaAI provides immediate, contextual answers to user queries, reducing the need for users to leave the app to search for details like recipes, locations, or product specs.

# 2. Core Features

Contextual Video Analysis: Computer vision and NLP process reel frames and metadata to identify objects, ingredients, or instructions.
In-App Chat Overlay: A seamless UI (accessible via a "spark" icon) that allows users to ask questions without pausing or exiting the reel.
Follow-up Dialogue: Support for multi-turn conversations to refine answers (e.g., "What can I use instead of dark chocolate?").
Real-time Response Generation: Low-latency inference to provide answers while the user is still engaged with the content.

# 3. Technical Requirements & Guardrails
PII & Safety Filter: Automatic redaction of any detected PII (usernames, addresses, or phone numbers) in generated responses.
Strict content moderation to prevent generating harmful or inappropriate instructions.
Model Constraints: The system must validate the source of information against the specific video to prevent "hallucinations" of data not present in the reel.
Latency Target: Responses should be delivered within $<1.5$ seconds to maintain the "real-time" experience.

# 4. User Experience (UX) Flow
Entry Point: User taps the InstaAI spark icon on the right-hand action bar of a Reel.
Interaction: A bottom-sheet chat interface opens. The user types or selects a suggested query (e.g., "What's the recipe?").
Processing: InstaAI analyzes the video data and generates a formatted response (e.g., Bulleted ingredients).
Refinement: The user can type a follow-up or close the sheet to return to the video.

# 5. Success Metrics
Metric           | Definition                                               | Goal  | 
Engagement Rate  | % of Reel viewers who interact with InstaAI              | >15%  |
Accuracy Score   | Human-evaluated relevance of AI answers to video content | >90%  |
Retention        | Users who return to use InstaAI within 7 days.           | >40%  |
Safety Violations| The number of times PII or unsafe content is surfaced.   |  0    |


# 6. Roadmap
Phase 1 (MVP): Support for high-intent categories: Cooking (recipes), fitness videos, financial advice related videos and DIY/Tutorials.
Phase 2: Integration with Instagram Shop for "Identify & Buy" functionality.
Phase 3: Voice-to-query support for hands-free interaction.
# 7. Observability & Tracing Documentation
# 7.1 Tracing Objectives
The tracing logic aims to provide a "black box" recording of every request to identify:
Vision Failures: Where the model failed to "see" a key ingredient or text in the video.
Reasoning Hallucinations: Where the model saw the data correctly but reached a false conclusion.
Guardrail Latency: Which specific safety check is slowing down the response.

# 7.2 The Trace Object Structure
Every interaction generates a unique TraceID containing the following telemetry:
Layer       | Data Captured                                                 | Purpose                                              |
Input       | User Query + Video ID + Timestamp                             | Contextual baseline.                                 |
Extraction  | OCR Text + Detected Objects + Audio Transcript                | Verify what the "eyes and ears" of the AI perceived. |
Prompt      | The final hidden system prompt sent to the LLM                | Audit the "instructions" vs the "output."            |
LLM Raw     | The unedited response from the model                          | Detect hallucinations before guardrails filtered them|
Guardrail   | Boolean flags (PII_Found, Safety_Trigger, Hallucination_Risk) | Measure guardrail accuracy                           |


# 7.3 Debugging Workflows
A. Hallucination Detection (Grounding Trace)
If a user reports an incorrect recipe, the trace allows us to compare the Extraction Layer (what was actually in the video) against the LLM Raw output.
Example: If the video shows "Honey" but the LLM says "Maple Syrup," and the extraction layer correctly identifies "Honey," we know the failure is in the Reasoning stage, not the Vision stage.
B. PII Leak Investigation
If a "False Negative" occurs (PII slips through), the trace logs exactly which NER (Named Entity Recognition) model failed to flag the entity, allowing for immediate retraining of the PII filter.

