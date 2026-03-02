/**
 * OpenRouter Service
 * Handles AI model interactions for article structure analysis and generation
 * @module services/OpenRouterService
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';

/**
 * OpenRouter API response structure
 */
interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Article block structure for generation
 */
export interface ArticleBlock {
  id: number;
  type: 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq';
  heading: string;
  instruction: string;
  lsi: string[];
  questions?: string[];
}

/**
 * Structure analysis result
 */
export interface StructureAnalysis {
  averageWordCount: number;
  commonPatterns: string[];
  strengths: string[];
  weaknesses: string[];
  recommendedStructure: ArticleBlock[];
}

/**
 * Token usage tracking interface
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * OpenRouter Service Class
 * Provides AI-powered content analysis and generation
 */
export class OpenRouterService {
  private client: AxiosInstance;
  private model: string;
  private tokenUsage: TokenUsage;

  constructor(apiKey: string, model: string = 'openai/gpt-5.2') {
    this.model = model;
    this.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.client = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://seo-articles-generator.local',
        'X-Title': 'SEO Articles Generator',
      },
      timeout: 120000, // 2 minutes for long responses
    });
  }

  /**
   * Get accumulated token usage and optionally reset
   */
  getTokenUsage(reset: boolean = false): TokenUsage {
    const usage = { ...this.tokenUsage };
    if (reset) {
      this.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    return usage;
  }

  /**
   * Reset token usage counter
   */
  resetTokenUsage(): void {
    this.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  /**
   * Validate API key
   */
  async validateApiKey(): Promise<{ isValid: boolean; error?: string }> {
    try {
      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.client.defaults.headers['Authorization']}`,
        },
        timeout: 10000,
      });
      return { isValid: response.status === 200 };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return { isValid: false, error: 'Invalid API key' };
      }
      return { isValid: false, error: 'Connection error' };
    }
  }

  /**
   * Send chat completion request to OpenRouter
   */
  private async chat(
    systemPrompt: string,
    userPrompt: string,
    temperature: number = 0.7
  ): Promise<string> {
    try {
      const response = await this.client.post<OpenRouterResponse>('/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: 8000,
      });

      // Accumulate token usage
      if (response.data.usage) {
        this.tokenUsage.promptTokens += response.data.usage.prompt_tokens || 0;
        this.tokenUsage.completionTokens += response.data.usage.completion_tokens || 0;
        this.tokenUsage.totalTokens += response.data.usage.total_tokens || 0;
      }

      if (response.data.choices && response.data.choices.length > 0) {
        return response.data.choices[0].message.content;
      }

      throw new Error('No response from model');
    } catch (error) {
      logger.error('OpenRouter chat error', { error });
      throw error;
    }
  }

  /**
   * Analyze competitor structures and generate recommended article structure
   */
  async analyzeStructures(
    mainKeyword: string,
    language: string,
    serpResults: Array<{
      position: number;
      title: string;
      url: string;
      headings?: string[];
      wordCount?: number;
      content?: string;
    }>,
    keywords: string[],
    lsiKeywords: string[],
    articleType: string = 'informational',
    comment?: string,
    minWords: number = 1200,
    maxWords: number = 1800
  ): Promise<StructureAnalysis> {
    // Calculate average word count from competitors (for reference)
    const wordCounts = serpResults
      .filter(r => r.wordCount && r.wordCount > 0)
      .map(r => r.wordCount!);
    const competitorAvgWordCount = wordCounts.length > 0
      ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
      : 2000;

    // Target the UPPER BOUND — AI consistently underdelivers word count
    const targetWordCount = maxWords;
    const averageWordCount = targetWordCount;

    // Calculate target H2/H3 content blocks (excluding H1, intro, conclusion, FAQ)
    const targetContentBlocks = Math.max(5, Math.min(12, Math.ceil((targetWordCount - 400) / 220)));
    // Note: total blocks = targetContentBlocks + 4 (H1, intro, conclusion, FAQ)

    // Prepare competitor structures for analysis
    const structuresText = serpResults
      .filter(r => r.headings && r.headings.length > 0)
      .map((r, idx) => {
        return `
=== Competitor #${r.position} ===
URL: ${r.url}
Title: ${r.title}
Word Count: ${r.wordCount || 'N/A'}
Structure:
${r.headings!.map(h => `  ${h}`).join('\n')}
`;
      })
      .join('\n');

    const languageNames: Record<string, string> = {
      'en': 'English',
      'de': 'German',
      'ru': 'Russian',
      'fr': 'French',
      'es': 'Spanish',
      'it': 'Italian',
      'pl': 'Polish',
      'uk': 'Ukrainian',
      'nl': 'Dutch',
      'pt': 'Portuguese',
    };

    const langName = languageNames[language] || 'English';

    // Build comment/style instructions section
    let styleInstructions = '';
    if (comment) {
      styleInstructions = `
AUTHOR'S STYLE INSTRUCTIONS (MUST FOLLOW):
${comment}
`;
    }

    // Build article type restrictions
    let typeRestrictions = '';
    if (articleType === 'informational') {
      typeRestrictions = `
ARTICLE TYPE: INFORMATIONAL
- NO commercial content, no selling, no pricing sections
- Focus on education, explanation, how-to
- If no pricing mentioned in style instructions, DO NOT create price-related headings
`;
    } else if (articleType === 'commercial') {
      typeRestrictions = `
ARTICLE TYPE: COMMERCIAL
- Include pricing, comparison, buying guides
- Focus on conversion and decision-making
`;
    }

    const systemPrompt = `You are an expert SEO content strategist and article structure analyst.
Your task is to analyze competitor article structures and create an optimal, unique structure for a new article.
Always respond in valid JSON format only, no markdown, no explanations outside JSON.
All text content (headings, instructions, etc.) must be in ${langName} language.
${styleInstructions}${typeRestrictions}`;

    const userPrompt = `Analyze these competitor article structures for the keyword "${mainKeyword}":

${structuresText}

Additional keywords to incorporate: ${keywords.join(', ')}
LSI keywords: ${lsiKeywords.join(', ')}
Target language: ${langName}
Average competitor word count: ${competitorAvgWordCount}
Target word count range: ${minWords}-${maxWords} words
Article type: ${articleType}${comment ? `\n\nAUTHOR'S INSTRUCTIONS:\n${comment}` : ''}

COMPETITOR H1 TITLES (analyze these carefully):
${serpResults.map((r, i) => `${i + 1}. "${r.title}"`).join('\n')}

CRITICAL H1 ANALYSIS TASK:
1. Analyze the patterns in competitor titles above
2. Find the angle ALL competitors MISS
3. Create a 100% UNIQUE H1 title that:
   - Takes a DIFFERENT angle than ALL competitors above
   - Includes main keyword "${mainKeyword}" naturally (with proper grammar/declension)
   - Is STRICTLY 40-65 characters (count carefully! This is a HARD LIMIT)
   - MUST NOT be a copy or slight variation of any competitor title
   - FORBIDDEN in H1: invented numbers ("34 Kriterien", "21 Tipps"), year numbers, clickbait, parenthetical additions, em-dashes with extra clauses
   - GOOD H1 pattern: concise, clear, one main promise. Example: "Ghostwriter für Soziale Arbeit: Leitfaden zur Wahl"
   - BAD H1 pattern: "Ghostwriter für Soziale Arbeit: ehrliche Checkliste mit 34 Kriterien (Risiken, Qualität) – ohne Werbung" — TOO LONG, invented number, multiple sub-clauses

TARGET: Create an article of ${maxWords} words (minimum ${minWords}). Generate ${targetContentBlocks} H2/H3 content blocks PLUS H1, intro, conclusion, and FAQ.
Create a comprehensive analysis and generate a unique, optimized article structure.

Return ONLY valid JSON in this exact format:
{
  "averageWordCount": ${averageWordCount},
  "commonPatterns": ["pattern1", "pattern2", ...],
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...],
  "recommendedStructure": [
    {
      "id": 0,
      "type": "h1",
      "heading": "Main H1 title in ${langName}",
      "instruction": "This is the main title, should include main keyword",
      "lsi": ["relevant", "lsi", "keywords"]
    },
    {
      "id": 1,
      "type": "intro",
      "heading": "",
      "instruction": "Introduction paragraph - no heading, just engaging opening text after H1...",
      "lsi": ["lsi", "for", "intro"]
    },
    ... more h2/h3 blocks with type, heading, instruction, lsi, and questions array ...
    {
      "id": N-1,
      "type": "conclusion",
      "heading": "Conclusion title in ${langName}",
      "instruction": "Summarize key points...",
      "lsi": ["conclusion", "lsi"]
    },
    {
      "id": N,
      "type": "faq",
      "heading": "FAQ title in ${langName}",
      "instruction": "Answer common questions about the topic",
      "lsi": ["faq", "lsi"]
    }
  ]
}

IMPORTANT RULES:
1. All headings and instructions MUST be in ${langName}
2. Block id=0 is H1 (see H1 ANALYSIS TASK above). NO questions in H1 block.
3. Block id=1 is always Introduction — heading MUST be EMPTY STRING "" (no "Einleitung"/"Introduction"!)
4. Second-to-last block must be Conclusion (no questions)
5. Last block must be FAQ (no questions), MAX 4 Q&A pairs
6. Content blocks (h2, h3) may have "questions" array with 0-5 SIMPLE research questions
7. CRITICAL: Generate exactly ${targetContentBlocks} H2/H3 content blocks (NOT counting H1, intro, conclusion, FAQ)
   - Use H2 for main sections and H3 for subsections under a parent H2
   - H3 blocks MUST immediately follow their parent H2 block
   - Natural mix: e.g. 4 H2 + 3 H3
   - Each block covers a DISTINCT subtopic — absolutely no redundancy between blocks
8. HEADINGS RULES:
   - Headings must be concise (5-10 words max)
   - NEVER put invented numbers in headings ("34 Kriterien", "21 Tipps", "7 Schritte") — unless you can ACTUALLY deliver that exact count in the content
   - NEVER put parenthetical clarifications in headings: "Heading (Risiken, Qualität, Passung)"
   - Headings must sound natural in ${langName}, like a native journalist would write
9. Each block should have 3-8 LSI keywords relevant to that section
10. TARGET ARTICLE LENGTH: aim for ${maxWords} words (minimum ${minWords})

CRITICAL - Question Generation Rules:
PURPOSE: Questions are used to search a knowledge base and the web for CONCRETE FACTS that make the article authoritative. The more specific data we find, the more expert the article reads.
- 0-7 questions per block: 0 for opinion/advice blocks, 5-7 for fact-heavy blocks
- Each question targets a DIFFERENT factual aspect: specific number, statistic, study result, comparison data, official name, year, price, percentage, legal reference, method name
- Questions MUST be SEARCHABLE — short phrases that match how facts are stored in databases
- Max 12 words per question
- PRIORITIZE questions that yield:
  * Specific numbers/statistics ("How many X exist?", "What percentage of X?")
  * Named studies or researchers ("Who researched X?", "What study proved X?")
  * Comparisons between options ("What is the price difference between X and Y?")
  * Official definitions or legal references ("What law regulates X?", "How is X officially defined?")
  * Year/date facts ("When was X introduced?", "Since when does X apply?")
- Good: "What is the average cost of X?", "What study showed X effectiveness?", "How many people use X annually?", "What law regulates X in Germany?", "What is the success rate of X?"
- BAD: "What challenges arise when implementing X?", "How does X impact society?"
- Avoid academic, philosophical, opinion-seeking, or multi-part questions`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.7);

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Invalid JSON response from AI');
      }

      const analysis = JSON.parse(jsonMatch[0]) as StructureAnalysis;

      // Validate structure
      if (!analysis.recommendedStructure || analysis.recommendedStructure.length < 5) {
        throw new Error('Invalid structure: too few blocks');
      }

      // Ensure intro block exists, has no questions, and has empty heading
      const introBlock = analysis.recommendedStructure.find(b => b.type === 'intro');
      if (introBlock) {
        delete introBlock.questions;
        introBlock.heading = ''; // No "Introduction"/"Einleitung" heading
      }

      // Ensure conclusion block has no questions
      const conclusionBlock = analysis.recommendedStructure.find(b => b.type === 'conclusion');
      if (conclusionBlock) {
        delete conclusionBlock.questions;
      }

      // Ensure FAQ block has no questions
      const faqBlock = analysis.recommendedStructure.find(b => b.type === 'faq');
      if (faqBlock) {
        delete faqBlock.questions;
      }

      // Ensure H1 block has no questions + clean up title
      const h1Block = analysis.recommendedStructure.find(b => b.type === 'h1');
      if (h1Block) {
        delete h1Block.questions;
        // Post-processing: strip markdown formatting, quotes, clean up
        let title = h1Block.heading;
        title = title.replace(/^#+\s*/, ''); // Strip leading # markdown
        title = title.replace(/^\*+|\*+$/g, ''); // Strip bold/italic markers
        title = title.replace(/^["'"'«»]+|["'"'«»]+$/g, ''); // Strip quotes
        // Remove parenthetical additions: (Risiken, Qualität, ...)
        title = title.replace(/\s*\([^)]*\)\s*/g, ' ');
        // Remove em-dash/en-dash trailing clauses: " – ohne Werbung..."
        title = title.replace(/\s*[–—]\s*[^–—]*$/, '');
        title = title.trim();
        // Hard limit: cut at last full word before 65 chars
        if (title.length > 65) {
          title = title.substring(0, 65);
          const lastSpace = title.lastIndexOf(' ');
          if (lastSpace > 30) {
            title = title.substring(0, lastSpace);
          }
        }
        h1Block.heading = title;
        logger.info(`H1 title (${title.length} chars): "${title}"`);
      }

      logger.info('Structure analysis completed', {
        blocksCount: analysis.recommendedStructure.length,
        averageWordCount: analysis.averageWordCount,
      });

      return analysis;
    } catch (error) {
      logger.error('Structure analysis failed', { error });
      throw new Error(`Structure analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Enrich blocks with detailed instructions
   */
  async enrichBlockInstructions(
    blocks: ArticleBlock[],
    mainKeyword: string,
    language: string,
    keywords: string[],
    lsiKeywords: string[],
    articleType: string = 'informational',
    comment?: string
  ): Promise<ArticleBlock[]> {
    const languageNames: Record<string, string> = {
      'en': 'English',
      'de': 'German',
      'ru': 'Russian',
      'fr': 'French',
      'es': 'Spanish',
      'it': 'Italian',
      'pl': 'Polish',
      'uk': 'Ukrainian',
      'nl': 'Dutch',
      'pt': 'Portuguese',
    };

    const langName = languageNames[language] || 'English';

    // Build comment/style instructions section
    let styleSection = '';
    if (comment) {
      styleSection = `
AUTHOR'S STYLE INSTRUCTIONS (MUST FOLLOW):
${comment}
`;
    }

    // Build article type restrictions
    let typeSection = '';
    if (articleType === 'informational') {
      typeSection = `
ARTICLE TYPE: INFORMATIONAL - no commercial content, no pricing, no selling.
`;
    } else if (articleType === 'commercial') {
      typeSection = `
ARTICLE TYPE: COMMERCIAL - include pricing, comparisons, buying guides.
`;
    }

    const systemPrompt = `You are an expert SEO content writer creating detailed writing instructions.
Your task is to enrich article block instructions with specific, actionable guidance.
Always respond in valid JSON format only.
All instructions must be in ${langName} language.
${styleSection}${typeSection}`;

    const blocksJson = JSON.stringify(blocks, null, 2);

    const userPrompt = `Enrich these article blocks with detailed writing instructions:

${blocksJson}

Main keyword: "${mainKeyword}"
Additional keywords: ${keywords.join(', ')}
LSI keywords: ${lsiKeywords.join(', ')}
Target language: ${langName}
Article type: ${articleType}${comment ? `\n\nAUTHOR'S INSTRUCTIONS:\n${comment}` : ''}

For each block, provide:
1. Detailed instruction (200-400 chars) explaining exactly what to write
2. Specific LSI keywords relevant to that section (5-10 per block)
3. For content blocks (h2/h3 only): generate 0-7 research questions that will fetch CONCRETE DATA

CRITICAL - Question Rules:
PURPOSE: These questions search a knowledge base + web for facts that make the article authoritative. More specific data = more expert article.
- FIRST assess: does this block have researchable facts? If YES → 5-7 questions. If opinion/advice → 0-2 questions.
- Each question targets a DIFFERENT factual aspect: number, statistic, study, comparison, legal ref, price, percentage, year
- Questions MUST be SEARCHABLE — short phrases matching database/web content
- Max 12 words per question, must end with ?
- PRIORITIZE questions that yield:
  * Statistics and numbers ("How many X?", "What percentage of X?")
  * Named studies/researchers ("What study proved X?", "Who developed X method?")
  * Comparisons ("What is the price of X vs Y?", "How does X compare to Y?")
  * Legal/official references ("What law regulates X?", "What is the official definition of X?")
  * Historical facts ("When was X introduced?", "Since when does X exist?")
- Good: "What is the success rate of X?", "What study showed X effectiveness?", "How many people use X in Germany?", "What law regulates X?"
- BAD: "What challenges arise when implementing X?", "How can one improve X?"
- NO academic, multi-part, opinion-seeking, or philosophical questions

Return the enriched blocks as JSON array in the same format, with improved instructions and LSI.
Keep the same structure but make instructions much more detailed and specific.
All text must be in ${langName}.`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.5);

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('Invalid JSON response');
      }

      const enrichedBlocks = JSON.parse(jsonMatch[0]) as ArticleBlock[];

      // Validate and clean up blocks + post-process questions
      return enrichedBlocks.map((block, idx) => {
        let questions = block.questions;
        // Strip invalid questions: >15 words or not ending with ?
        if (questions && questions.length > 0) {
          questions = questions.filter(q => {
            const trimmed = q.trim();
            if (!trimmed.endsWith('?')) return false;
            if (trimmed.split(/\s+/).length > 15) return false;
            return true;
          });
        }
        return {
          ...block,
          id: idx,
          questions: ['intro', 'conclusion', 'faq', 'h1'].includes(block.type)
            ? undefined
            : (questions && questions.length > 0 ? questions : undefined),
        };
      });
    } catch (error) {
      logger.error('Block enrichment failed', { error });
      // Return original blocks if enrichment fails
      return blocks;
    }
  }

  /**
   * Generate content for a single article block
   * Uses accumulated context from previous blocks for style consistency
   */
  async generateBlockContent(
    block: {
      id: number;
      type: 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq';
      heading: string;
      instruction: string;
      lsi: string[];
      answeredQuestions?: Array<{
        question: string;
        answer: string;
        source?: string;
      }>;
    },
    previousContent: string,
    mainKeyword: string,
    language: string,
    targetWordCount: number,
    articleType: string = 'informational',
    comment?: string
  ): Promise<string> {
    const languageNames: Record<string, string> = {
      'en': 'English',
      'de': 'German',
      'ru': 'Russian',
      'fr': 'French',
      'es': 'Spanish',
      'it': 'Italian',
      'pl': 'Polish',
      'uk': 'Ukrainian',
      'nl': 'Dutch',
      'pt': 'Portuguese',
    };

    const langName = languageNames[language] || 'English';
    const hasFactsFromResearch = block.answeredQuestions && block.answeredQuestions.length > 0;

    // Build facts section if we have answered questions
    let factsSection = '';
    if (hasFactsFromResearch) {
      factsSection = `
VERIFIED FACTS TO INCLUDE (from research):
${block.answeredQuestions!.map((aq, i) => `${i + 1}. ${aq.question}
   Answer: ${aq.answer}
   ${aq.source ? `Source: ${aq.source}` : ''}`).join('\n')}

You MUST incorporate these facts naturally into the text. These are verified information from reliable sources.
`;
    }

    // Determine block-specific instructions
    let blockTypeInstructions = '';
    let estimatedWords = 0;

    switch (block.type) {
      case 'h1':
        blockTypeInstructions = `This is the main title (H1) of the article.
Return ONLY the title text, nothing else. The title should be compelling and include the main keyword.
Do not add any content, just the title.`;
        estimatedWords = 10;
        break;

      case 'intro':
        {
          // Scale intro proportionally: ~10% of target word count
          const introTarget = Math.round(targetWordCount * 0.10);
          const introMin = Math.max(120, introTarget - 30);
          const introMax = introTarget + 40;
          estimatedWords = introTarget;
          blockTypeInstructions = `Write an engaging introduction (2-3 paragraphs).
- Hook the reader immediately with a relatable scenario or question
- Introduce the topic and its importance
- Preview what the article will cover
- Include the main keyword naturally
- ${introMin}-${introMax} words — make it substantial, not a throwaway paragraph`;
        }
        break;

      case 'h2':
      case 'h3':
        {
          // Calculate words per content block — same formula as analyzeStructures
          // Reserve ~15% for intro+conclusion+faq, rest split among H2/H3 content blocks
          const reservedWords = Math.round(targetWordCount * 0.15);
          const targetContentBlocks = Math.max(5, Math.min(12, Math.ceil((targetWordCount - 400) / 220)));
          const wordsPerBlock = Math.round((targetWordCount - reservedWords) / targetContentBlocks);
          estimatedWords = Math.max(150, Math.min(350, wordsPerBlock));
          const hardCeiling = estimatedWords + 50;
          blockTypeInstructions = `Write ${estimatedWords}-${hardCeiling} words for this section. HARD MAXIMUM: ${hardCeiling} words. Going over is WORSE than being too brief.
- Start with 1-2 paragraphs of PROSE, then optionally add a short list or table if the content lends itself to it.
- Start directly with content (heading is already defined).
- Every sentence adds NEW information — no restating what was said before in this article.
- Use LSI keywords with proper grammatical adaptation.
- Use formatting that shows EXPERTISE: a short bullet list for practical items, a comparison table for data, bold for key terms. But always have prose too — never a section that is ONLY a list.
${hasFactsFromResearch ? '- MUST include the verified facts provided above, integrated naturally.' : '- Write informatively but do NOT invent specific numbers, statistics, or research citations.'}`;
        }
        break;

      case 'conclusion':
        {
          // Scale conclusion: ~10% of target word count for a proper wrap-up
          const concTarget = Math.round(targetWordCount * 0.10);
          const concMin = Math.max(120, concTarget - 30);
          const concMax = concTarget + 50;
          estimatedWords = concTarget;
          blockTypeInstructions = `Write a COMPREHENSIVE conclusion that wraps up the entire article. ${concMin}-${concMax} words.

This conclusion must feel like a PROPER ENDING, not an abrupt stop. Structure:

1. SYNTHESIS (not just summary): Connect the key insights from all previous sections into a coherent final picture. Show how the different parts relate to each other.
2. KEY TAKEAWAYS: Distill 3-5 concrete, actionable takeaways the reader should remember. These should be specific, not generic platitudes.
3. FINAL PERSPECTIVE: End with a strong, memorable closing thought — a recommendation, a forward-looking statement, or a decisive opinion that puts a definitive period on the article.

IMPORTANT:
- Reference specific concepts, data, or examples from the article above — prove you've read the whole thing
- Do NOT introduce completely new topics
- Do NOT use generic filler like "In conclusion..." or "To summarize..."
- Make the reader feel they've gained clear, complete knowledge on this topic`;
        }
        break;

      case 'faq':
        blockTypeInstructions = `Generate EXACTLY 4 FAQ items. NO MORE THAN 4. NO LESS THAN 4.

Read through the article above and pick the 4 MOST important unanswered questions a reader would have.

Format each as:
**Q: [Short practical question]**
A: [Concise answer — 1-2 sentences, 30-50 words max]

RULES:
- EXACTLY 4 items — count them before responding
- Questions must be SHORT and practical (what real people google)
- Answers must be CONCISE — 1-2 sentences, no more
- Each answer adds NEW value — don't repeat what the article already covers
- Total FAQ section: 200-250 words maximum`;
        estimatedWords = 220;
        break;
    }

    // Build style instructions from comment
    let styleRules = '';
    if (comment) {
      styleRules = `
AUTHOR'S STYLE INSTRUCTIONS (MUST FOLLOW):
${comment}
`;
    }

    // Build article type rules
    let typeRules = '';
    if (articleType === 'informational') {
      typeRules = `
8. INFORMATIONAL ARTICLE: NO commercial content, NO pricing, NO selling, NO calls to buy
`;
    } else if (articleType === 'commercial') {
      typeRules = `
8. COMMERCIAL ARTICLE: Include pricing info, comparisons, buying recommendations where relevant
`;
    }

    const systemPrompt = `You are an expert content writer creating a high-quality article in ${langName}. You write like a skilled native ${langName} journalist — clear, natural, engaging.
${styleRules}
CRITICAL RULES:
1. Write ONLY in ${langName}. Use natural phrasing that a native speaker would actually use — not textbook language, not robotic, not overly colloquial.
2. Match the style and tone of the previous content for consistency.
3. WRITING STYLE — EXPERT MIX:
   - The foundation is PROSE PARAGRAPHS — flowing text that reads like a real article.
   - BUT: vary formatting to show expertise and improve readability:
     * Short bullet lists (3-6 items) when listing concrete things (criteria, steps, features, pros/cons)
     * A comparison table when comparing 2-4 options side by side (prices, features, providers)
     * Bold key terms or short phrases to highlight important concepts
     * Numbered lists for step-by-step processes
   - BALANCE: each section should have at least 1-2 paragraphs of prose. A section can ALSO include a list or table, but never ONLY a list.
   - Aim for variety across sections: if one section is pure prose, the next might have a short list or table. This keeps readers engaged.
4. Do NOT invent statistics, numbers, percentages, research findings, or specific counts unless provided in VERIFIED FACTS. NEVER put invented numbers in headings (e.g. "34 Kriterien", "21 Tipps").
5. KEYWORD INTEGRATION: Keywords and LSI phrases are given in BASE FORM. You MUST adapt them grammatically:
   - Add correct articles, prepositions, case endings as required by ${langName} grammar
   - Decline nouns, conjugate verbs, adjust adjective endings
   - The keyword must read as NATURAL TEXT — never as a raw phrase stuffed into a sentence
   - It is OK to split multi-word keywords across the sentence if more natural
6. Do NOT add the heading — just write the content for this section.
7. NO REPETITION: Each paragraph must introduce NEW information or a new angle. Never restate the same idea in different words. If you've already said it — move on.
8. MAIN KEYWORD: provided for CONTEXT ONLY. Do NOT force it into text. Prefer synonyms or not using it at all. FORBIDDEN: "when you search for [keyword]...", keyword in quotes, keyword as a search term.${typeRules}`;

    let userPrompt = ``;

    // Add previous content for context (if any)
    if (previousContent && previousContent.trim().length > 0) {
      userPrompt += `=== ARTICLE SO FAR (for context and style consistency) ===
${previousContent}

=== END OF PREVIOUS CONTENT ===

`;
    }

    userPrompt += `Now write content for the next section:

SECTION HEADING: ${block.heading}
SECTION TYPE: ${block.type.toUpperCase()}
WRITING INSTRUCTION: ${block.instruction}
LSI KEYWORDS TO USE: ${block.lsi.join(', ')}
MAIN KEYWORD (for context only — see rule 8): ${mainKeyword}
ARTICLE TYPE: ${articleType}${comment ? `\nAUTHOR'S INSTRUCTIONS: ${comment}` : ''}
${factsSection}
${blockTypeInstructions}

Write the content now:`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.7);

      // Clean up response
      let content = response.trim();

      // Remove any markdown code blocks if present
      content = content.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '');

      logger.debug(`Generated content for block ${block.id} (${block.type})`, {
        wordCount: content.split(/\s+/).length,
        hasFactsUsed: hasFactsFromResearch,
      });

      return content;
    } catch (error) {
      logger.error(`Failed to generate content for block ${block.id}`, { error });
      throw new Error(`Content generation failed for block ${block.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Select appropriate blocks for internal link insertion
   *
   * Rules:
   * - intro: ALL links go to intro block (multiple links allowed)
   * - body: ONE link per block, AI selects best blocks from h2/h3
   * - conclusion: ALL links go to conclusion block (multiple links allowed)
   * - any: ONE link per block from any except h1/faq
   *
   * For anchorless links: anchor = URL itself (e.g. [https://url/](https://url/))
   */
  async selectBlocksForLinks(
    blocks: Array<{
      id: number;
      type: 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq';
      heading: string;
      content?: string;
    }>,
    links: Array<{
      url: string;
      anchor?: string;
      isAnchorless: boolean;
      displayType: 'inline' | 'list_end' | 'list_start' | 'sidebar';
      position: 'intro' | 'body' | 'conclusion' | 'any';
    }>,
    language: string
  ): Promise<Array<{ linkIndex: number; blockId: number; finalAnchor: string }>> {
    if (links.length === 0) return [];

    const results: Array<{ linkIndex: number; blockId: number; finalAnchor: string }> = [];
    const usedBlockIds = new Set<number>(); // Only for body/any positions

    // Find special blocks
    const introBlock = blocks.find(b => b.type === 'intro' && b.content);
    const conclusionBlock = blocks.find(b => b.type === 'conclusion' && b.content);
    const bodyBlocks = blocks.filter(b =>
      (b.type === 'h2' || b.type === 'h3') && b.content
    );

    // Process each link
    for (let linkIndex = 0; linkIndex < links.length; linkIndex++) {
      const link = links[linkIndex];

      // Determine final anchor: if anchorless, use URL as anchor
      const finalAnchor = link.isAnchorless ? link.url : (link.anchor || link.url);

      let selectedBlock: typeof blocks[0] | undefined;

      switch (link.position) {
        case 'intro':
          // ALL intro links go to intro block (no uniqueness check)
          selectedBlock = introBlock;
          break;

        case 'conclusion':
          // ALL conclusion links go to conclusion block (no uniqueness check)
          selectedBlock = conclusionBlock;
          break;

        case 'body':
          // ONE link per body block
          selectedBlock = bodyBlocks.find(b => !usedBlockIds.has(b.id));
          if (selectedBlock) {
            usedBlockIds.add(selectedBlock.id);
          }
          break;

        case 'any':
          // ONE link per block from any (except h1/faq)
          const anyBlocks = blocks.filter(b =>
            b.type !== 'h1' && b.type !== 'faq' && b.content && !usedBlockIds.has(b.id)
          );
          selectedBlock = anyBlocks[0];
          if (selectedBlock) {
            usedBlockIds.add(selectedBlock.id);
          }
          break;
      }

      if (!selectedBlock) {
        logger.warn(`No eligible block found for link ${linkIndex} with position "${link.position}"`);
        continue;
      }

      results.push({
        linkIndex,
        blockId: selectedBlock.id,
        finalAnchor,
      });

      logger.info(`Link ${linkIndex} (position: ${link.position}) -> Block #${selectedBlock.id} (type: ${selectedBlock.type}), anchor: "${finalAnchor}"`);
    }

    return results;
  }

  /**
   * Insert a SINGLE link into block content
   * Processes ONE link per AI call for maximum reliability
   * Anchor text is NEVER changed - use exactly as provided
   *
   * For anchorless links, use URL as anchor in "Learn more at [url](url)" style
   */
  async insertSingleLink(
    blockContent: string,
    blockHeading: string,
    link: {
      url: string;
      anchor: string; // EXACT anchor to use, never change
      isAnchorless: boolean;
      displayType: 'inline' | 'list_end' | 'list_start' | 'sidebar';
    },
    language: string
  ): Promise<string> {
    const languageNames: Record<string, string> = {
      'en': 'English', 'de': 'German', 'ru': 'Russian', 'fr': 'French',
      'es': 'Spanish', 'it': 'Italian', 'pl': 'Polish', 'uk': 'Ukrainian',
      'nl': 'Dutch', 'pt': 'Portuguese',
    };
    const langName = languageNames[language] || 'English';

    const linkMarkdown = `[${link.anchor}](${link.url})`;

    // Build display-type-specific instruction
    let insertionInstruction = '';
    switch (link.displayType) {
      case 'inline':
        if (link.isAnchorless) {
          insertionInstruction = `Insert this link INLINE into an EXISTING sentence or at the end of an existing paragraph. Add a phrase like "Learn more at ${linkMarkdown}" or "Details available at ${linkMarkdown}".

CRITICAL: The link must be PART OF A PARAGRAPH — within or appended to an existing sentence.
ABSOLUTELY FORBIDDEN: Placing the link on its own separate line. The link must NEVER appear as a standalone line.`;
        } else {
          insertionInstruction = `INLINE LINK INSERTION — GRAMMATICAL INTEGRATION

Anchor phrase (search keyword): "${link.anchor}"
URL: ${link.url}

The anchor is a SEARCH KEYWORD that users type into Google. Your job is to weave it into an existing sentence so it reads like natural ${langName} prose.

ANCHOR RULES — what you CAN and CANNOT change inside [brackets]:
- ALL keyword words MUST appear inside [brackets] in the SAME ORDER
- You CAN insert small grammatical particles inside [brackets] if the language grammar REQUIRES it:
  "zu", "zu den", "für", "von", "im", "am", "zum", "zur", "des", "der", "das", "die", "ein", "eine", "einen" etc.
- You CANNOT remove, replace, or reorder any keyword word
- You CANNOT add adjectives or extra content words inside [brackets]

TECHNIQUE — 3 STEPS:
1. Pick ONE existing sentence that is thematically related to the anchor
2. REWRITE that sentence so the anchor becomes a grammatical element (subject, object, attribute, adverbial)
3. Add grammar BOTH inside [brackets] (particles if needed) AND outside (articles, prepositions, case endings)

EXAMPLES (German):
- Anchor "Bachelorarbeit schreiben lassen"
  BEFORE: "Viele Studierende stehen unter Zeitdruck bei der Abschlussarbeit."
  AFTER: "Viele Studierende entscheiden sich, eine [Bachelorarbeit schreiben zu lassen](${link.url}), um den Zeitdruck zu reduzieren."
  → "zu" inserted inside brackets for infinitive construction — keyword intact

- Anchor "Ghostwriter Masterarbeit"
  BEFORE: "Professionelle Unterstützung macht den Unterschied."
  AFTER: "Ein erfahrener [Ghostwriter Masterarbeit](${link.url}) macht dabei den entscheidenden Unterschied."
  → compound term used as-is, article + adjective outside

- Anchor "Hausarbeit schreiben lassen Preise"
  BEFORE: "Die Kosten variieren je nach Umfang und Fachgebiet."
  AFTER: "Die [Hausarbeit schreiben lassen Preise](${link.url}) variieren je nach Umfang, Fachgebiet und Seitenzahl."
  → anchor used as compound noun subject, no particles needed

- Anchor "Doktorarbeit Hilfe"
  BEFORE: "Wer Unterstützung sucht, findet verschiedene Angebote."
  AFTER: "Wer professionelle [Doktorarbeit Hilfe](${link.url}) sucht, findet heute verschiedene seriöse Angebote."
  → adjective outside, anchor as object

- Anchor "academic writing service" (English)
  BEFORE: "Students often need professional support."
  AFTER: "Students who use a reputable [academic writing service](${link.url}) often achieve better results."
  → article + adjective outside, anchor as object

ABSOLUTELY FORBIDDEN:
- Link on its OWN LINE (standalone, between paragraphs) ← #1 ERROR, NEVER DO THIS
- "[anchor](url)" alone on a line ← NEVER
- "Mehr Infos: [anchor](url)" ← label style, not prose
- "Seiten wie [anchor](url)" ← treats anchor as website name
- "Begriffe wie [anchor](url)" ← treats anchor as search term
- Adding a NEW sentence just for the link ← must REWRITE an existing sentence

RULES:
- REWRITE one existing sentence — do NOT add new sentences
- The reader should NOT notice it's a link — reads as natural ${langName} text
- Keep ALL other content identical — change only the ONE sentence
- The line with the link MUST have substantial surrounding text (40+ chars without the link)`;
        }
        break;
      case 'list_start':
        insertionInstruction = `Add 1-2 natural introductory sentences at the VERY START of the content that include this link: ${linkMarkdown}. The sentences should introduce the topic and naturally lead into the existing content.`;
        break;
      case 'list_end':
        insertionInstruction = `Add 1-2 natural closing sentences at the VERY END of the content that include this link: ${linkMarkdown}. The sentences should summarize or extend the topic and include the link naturally.`;
        break;
      case 'sidebar':
        insertionInstruction = `Append at the very end of the content:\n\n**See also:** ${linkMarkdown}\n\nDo NOT modify the existing content at all. Only add this one line at the end.`;
        break;
    }

    // ─── INLINE (non-anchorless): focused paragraph approach ───
    // Instead of sending the entire block and hoping AI inserts the link,
    // we pick ONE paragraph and ask AI to rewrite just that paragraph.
    // This is far more reliable because the AI works with 2-3 sentences, not 300 words.
    if (link.displayType === 'inline' && !link.isAnchorless) {
      return this.insertInlineLinkViaParagraph(blockContent, link, language);
    }

    // ─── All other display types: full-block approach ───
    const systemPrompt = `You are a markdown editor inserting exactly ONE internal link into content.

CRITICAL RULES:
1. The anchor is a search keyword. Keep ALL keyword words inside [brackets] in the same order. You MAY insert small grammatical particles (zu, für, von, im, der, die, das, ein, eine...) inside brackets if the language grammar requires it. NEVER remove or replace keyword words.
2. DO NOT change the URL under any circumstances
3. Preserve ALL existing markdown formatting (bold, lists, other links, etc.)
4. Write in ${langName}
5. Return ONLY the updated content, no explanations or commentary
6. DO NOT wrap output in code blocks`;

    const userPrompt = `Insert ONE link into this content:

=== BLOCK HEADING ===
${blockHeading}

=== CURRENT CONTENT ===
${blockContent}

=== LINK TO INSERT ===
${linkMarkdown}
Display type: ${link.displayType}

=== INSTRUCTION ===
${insertionInstruction}

Return the updated content with the link inserted:`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.3);
      let updatedContent = response.trim();
      updatedContent = updatedContent.replace(/^```(?:markdown|md)?\n?/gm, '').replace(/\n?```$/gm, '');

      // Verify the link URL is present
      const urlVariants = [
        link.url,
        link.url.endsWith('/') ? link.url.slice(0, -1) : link.url + '/',
      ];
      const urlFound = urlVariants.some(url => updatedContent.includes(url));

      if (!urlFound) {
        logger.warn(`Link URL not found in AI response, force-appending: ${linkMarkdown}`);
        if (link.displayType === 'list_start') {
          updatedContent = `${linkMarkdown}\n\n${updatedContent}`;
        } else if (link.displayType === 'sidebar') {
          updatedContent += `\n\n**See also:** ${linkMarkdown}`;
        } else if (link.displayType === 'inline') {
          // Anchorless inline — append to last paragraph
          updatedContent += ` ${linkMarkdown}`;
        } else {
          updatedContent += `\n\n${linkMarkdown}`;
        }
      }

      return updatedContent;
    } catch (error) {
      logger.error(`Failed to insert link into block "${blockHeading}"`, { error });
      if (link.displayType === 'list_start') {
        return `${linkMarkdown}\n\n${blockContent}`;
      } else if (link.displayType === 'sidebar') {
        return `${blockContent}\n\n**See also:** ${linkMarkdown}`;
      }
      return `${blockContent}\n\n${linkMarkdown}`;
    }
  }

  /**
   * PRIMARY method for inline link insertion.
   * Picks ONE paragraph from the block and asks AI to rewrite just that paragraph.
   * Much more reliable than sending the entire block — AI works with 2-3 sentences, not 300 words.
   * Has built-in validation + deterministic fallback.
   */
  private async insertInlineLinkViaParagraph(
    blockContent: string,
    link: { url: string; anchor: string; isAnchorless: boolean; displayType: string },
    language: string
  ): Promise<string> {
    const languageNames: Record<string, string> = {
      'en': 'English', 'de': 'German', 'ru': 'Russian', 'fr': 'French',
      'es': 'Spanish', 'it': 'Italian', 'pl': 'Polish', 'uk': 'Ukrainian',
      'nl': 'Dutch', 'pt': 'Portuguese',
    };
    const langName = languageNames[language] || 'English';
    const linkMarkdown = `[${link.anchor}](${link.url})`;

    // Split content into paragraphs and pick the best prose paragraph
    const paragraphs = blockContent.split(/\n\n+/);
    let bestIdx = 0;
    let bestLen = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i].trim();
      // Skip headings, lists, tables, short lines
      if (/^[#|>*\-\d]/.test(p)) continue;
      if (p.length > bestLen) {
        bestLen = p.length;
        bestIdx = i;
      }
    }

    const targetParagraph = paragraphs[bestIdx];

    const systemPrompt = `You rewrite a single paragraph to include exactly one markdown link. Return ONLY the rewritten paragraph — no explanations, no code blocks, no extra text. Write in ${langName}.`;

    const userPrompt = `Rewrite this paragraph so the link is grammatically woven into ONE of its sentences.

PARAGRAPH:
${targetParagraph}

LINK TO INSERT: [${link.anchor}](${link.url})

ANCHOR RULES:
- "${link.anchor}" is a search keyword — ALL these words MUST appear inside [brackets] in the same order
- You CAN insert grammatical particles inside brackets if the language requires it (zu, für, von, im, der, die, das, ein, eine, einen...)
- You CANNOT remove, replace, or reorder keyword words
- Add grammar outside brackets too (articles, prepositions, case endings)

TECHNIQUE:
1. Pick ONE sentence that is thematically closest to the anchor topic
2. REWRITE that sentence so the anchor becomes a natural grammatical element (subject, object, attribute)
3. Keep all OTHER sentences unchanged

EXAMPLES:
- Anchor "Bachelorarbeit schreiben lassen", URL ${link.url}
  BEFORE: "Viele Studierende stehen unter Zeitdruck bei der Abschlussarbeit."
  AFTER: "Viele Studierende entscheiden sich, eine [Bachelorarbeit schreiben zu lassen](${link.url}), um den Zeitdruck zu reduzieren."

- Anchor "Ghostwriter Masterarbeit", URL ${link.url}
  BEFORE: "Professionelle Unterstützung macht den Unterschied."
  AFTER: "Ein erfahrener [Ghostwriter Masterarbeit](${link.url}) macht dabei den entscheidenden Unterschied."

FORBIDDEN:
- Link on its own line — NEVER
- "[anchor](url)" without surrounding sentence — NEVER
- "Mehr Infos: [anchor](url)" — NEVER
- Adding a brand-new sentence just for the link — rewrite an EXISTING one

Return ONLY the rewritten paragraph:`;

    // Attempt 1: temperature 0.4
    for (const temp of [0.4, 0.6]) {
      try {
        let result = await this.chat(systemPrompt, userPrompt, temp);
        result = result.trim().replace(/^```(?:markdown|md)?\n?/gm, '').replace(/\n?```$/gm, '');

        // Validate: URL present AND not standalone
        const urlPresent = result.includes(link.url) ||
          result.includes(link.url.endsWith('/') ? link.url.slice(0, -1) : link.url + '/');

        if (urlPresent) {
          const linkLine = result.split('\n').find(l => l.includes(link.url));
          if (linkLine) {
            const textAround = linkLine.replace(/\[[^\]]+\]\([^)]+\)/, '').trim();
            if (textAround.length >= 40) {
              // Success — link is properly woven in
              logger.info(`Inline link inserted successfully (temp=${temp}): "${linkLine.trim().slice(0, 100)}..."`);
              paragraphs[bestIdx] = result;
              return paragraphs.join('\n\n');
            }
            logger.warn(`Inline link isolated (${textAround.length} chars, temp=${temp}), ${temp === 0.4 ? 'retrying...' : 'will force-insert'}`);
          }
        } else {
          logger.warn(`URL missing from AI response (temp=${temp}), ${temp === 0.4 ? 'retrying...' : 'will force-insert'}`);
        }
      } catch (error) {
        logger.warn(`AI call failed (temp=${temp}): ${error}`);
      }
    }

    // Both attempts failed — deterministic fallback
    logger.warn(`Both AI attempts failed for inline link [${link.anchor}], using deterministic fallback`);
    paragraphs[bestIdx] = this.forceInsertLinkIntoParagraph(targetParagraph, linkMarkdown);
    return paragraphs.join('\n\n');
  }

  /**
   * Deterministic fallback: insert a link into a paragraph's last sentence.
   * Finds the last sentence-ending punctuation and inserts the link before it.
   * Guaranteed to produce an inline link, never standalone.
   */
  private forceInsertLinkIntoParagraph(paragraph: string, linkMarkdown: string): string {
    // Find sentences by splitting on sentence-ending punctuation
    // We want to insert the link into the last real sentence
    const sentences = paragraph.split(/(?<=[.!?])\s+/);

    if (sentences.length >= 2) {
      // Insert before the last sentence's final punctuation
      const lastSentence = sentences[sentences.length - 1];
      const punctMatch = lastSentence.match(/([.!?])\s*$/);
      if (punctMatch) {
        const punct = punctMatch[1];
        const idx = lastSentence.lastIndexOf(punct);
        sentences[sentences.length - 1] = lastSentence.slice(0, idx) + ` — ${linkMarkdown}` + punct;
      } else {
        sentences[sentences.length - 1] = lastSentence + ` — ${linkMarkdown}.`;
      }
      return sentences.join(' ');
    }

    // Single sentence paragraph — insert before final punctuation
    const punctMatch = paragraph.match(/([.!?])\s*$/);
    if (punctMatch) {
      const punct = punctMatch[1];
      const idx = paragraph.lastIndexOf(punct);
      return paragraph.slice(0, idx) + ` — ${linkMarkdown}` + punct;
    }

    return paragraph + ` — ${linkMarkdown}.`;
  }

  /**
   * Comprehensive article review with multiple quality checks
   * Returns structured results for each check category
   */
  async comprehensiveReview(
    blocks: Array<{
      id: number;
      type: 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq';
      heading: string;
      content?: string;
    }>,
    configuredLinks: Array<{ url: string; anchor?: string }>,
    minWords: number,
    maxWords: number,
    mainKeyword: string,
    language: string,
    articleType: string = 'informational',
    comment?: string
  ): Promise<{
    passed: boolean;
    wordCountCheck: { passed: boolean; actual: number; min: number; max: number };
    linkCountCheck: { passed: boolean; actual: number; expected: number; missingUrls: string[] };
    linkQualityCheck: { passed: boolean; issues: Array<{ blockId: number; issue: string }> };
    keywordDensityCheck: { passed: boolean; count: number; issues: string[] };
    rhythmCheck: { passed: boolean; blocksToFix: Array<{ blockId: number; issues: string[]; suggestion: string }> };
  }> {
    const languageNames: Record<string, string> = {
      'en': 'English', 'de': 'German', 'ru': 'Russian', 'fr': 'French',
      'es': 'Spanish', 'it': 'Italian', 'pl': 'Polish', 'uk': 'Ukrainian',
      'nl': 'Dutch', 'pt': 'Portuguese',
    };
    const langName = languageNames[language] || 'English';

    // === CHECK 1: Word count ===
    const fullText = blocks
      .filter(b => b.content && b.type !== 'h1')
      .map(b => b.content)
      .join(' ');
    const actualWordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
    const wordCountCheck = {
      passed: actualWordCount >= minWords && actualWordCount <= maxWords,
      actual: actualWordCount,
      min: minWords,
      max: maxWords,
    };

    // === CHECK 2: Link count ===
    const articleText = blocks.map(b => b.content || '').join('\n');
    const presentUrls = configuredLinks.filter(link => {
      const urlVariants = [
        link.url,
        link.url.endsWith('/') ? link.url.slice(0, -1) : link.url + '/',
      ];
      return urlVariants.some(url => articleText.includes(url));
    });
    const missingUrls = configuredLinks
      .filter(link => {
        const urlVariants = [
          link.url,
          link.url.endsWith('/') ? link.url.slice(0, -1) : link.url + '/',
        ];
        return !urlVariants.some(url => articleText.includes(url));
      })
      .map(l => l.url);
    const linkCountCheck = {
      passed: presentUrls.length === configuredLinks.length,
      actual: presentUrls.length,
      expected: configuredLinks.length,
      missingUrls,
    };

    // === CHECK 3: Link quality (check for unnatural phrasing around links) ===
    const linkQualityIssues: Array<{ blockId: number; issue: string }> = [];
    for (const block of blocks) {
      if (!block.content) continue;
      // Check for quoted links like "See also:", links in parentheses, or links surrounded by quotes
      const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
      let linkMatch;
      while ((linkMatch = linkRegex.exec(block.content)) !== null) {
        const fullMatch = linkMatch[0];
        const matchIndex = linkMatch.index;
        const before = block.content.substring(Math.max(0, matchIndex - 30), matchIndex);

        // Check for unnatural patterns
        if (/["'«»]\s*$/.test(before) || /["'«»]/.test(block.content.substring(matchIndex + fullMatch.length, matchIndex + fullMatch.length + 5))) {
          linkQualityIssues.push({ blockId: block.id, issue: `Link "${linkMatch[1]}" appears to be quoted unnaturally` });
        }
      }
    }
    const linkQualityCheck = {
      passed: linkQualityIssues.length === 0,
      issues: linkQualityIssues,
    };

    // === CHECK 4: Main keyword usage (max 4-5 occurrences, all grammatically correct) ===
    const keywordLower = mainKeyword.toLowerCase();
    const textLower = fullText.toLowerCase();
    let keywordCount = 0;
    let searchIndex = 0;
    while ((searchIndex = textLower.indexOf(keywordLower, searchIndex)) !== -1) {
      keywordCount++;
      searchIndex += keywordLower.length;
    }
    const densityIssues: string[] = [];
    const MAX_KEYWORD_OCCURRENCES = 5;
    if (keywordCount > MAX_KEYWORD_OCCURRENCES) {
      densityIssues.push(`Main keyword "${mainKeyword}" appears ${keywordCount} times (max ${MAX_KEYWORD_OCCURRENCES}). Reduce occurrences — replace extras with synonyms or rephrase. High-frequency keywords spammed in text trigger search engine spam filters.`);
    }
    // Check for raw/ungrammatical usage: keyword surrounded by quotes, used as a search term, etc.
    const rawPatterns = [
      new RegExp(`"${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'gi'), // "keyword" in quotes
      new RegExp(`«${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}»`, 'gi'), // «keyword» in quotes
      new RegExp(`(suche nach|searching for|search for|поиск|при поиске|когда ищешь)\\s+.{0,10}${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), // "when searching for keyword"
    ];
    for (const pattern of rawPatterns) {
      const matches = fullText.match(pattern);
      if (matches && matches.length > 0) {
        densityIssues.push(`Main keyword used as a raw search term or in quotes: "${matches[0]}". Rephrase to use the concept naturally with proper grammar.`);
      }
    }
    const keywordDensityCheck = {
      passed: keywordCount <= MAX_KEYWORD_OCCURRENCES && densityIssues.length === 0,
      count: keywordCount,
      issues: densityIssues,
    };

    // === CHECK 5: Rhythm — AI-powered check for transitions, filler, repetitions ===
    let rhythmBlocksToFix: Array<{ blockId: number; issues: string[]; suggestion: string }> = [];
    try {
      const articleWithIds = blocks
        .filter(b => b.content && b.type !== 'h1')
        .map(b => `[BLOCK ${b.id}] ${b.type.toUpperCase()}: ${b.heading}\n${b.content}`)
        .join('\n\n---\n\n');

      let typeCheckRules = '';
      if (articleType === 'informational') {
        typeCheckRules = '\n6. COMMERCIAL CONTAMINATION - flag ANY commercial content, pricing, selling language in INFORMATIONAL article';
      } else if (articleType === 'commercial') {
        typeCheckRules = '\n6. MISSING COMMERCIAL ELEMENTS - note if pricing/CTA is missing in COMMERCIAL article';
      }

      let styleCheckRules = '';
      if (comment) {
        styleCheckRules = `\n7. STYLE COMPLIANCE - check if content follows: "${comment}"`;
      }

      const systemPrompt = `You are a professional ${langName}-native editor. Review article quality.

Check ONLY for SERIOUS problems:
1. UNNATURAL LANGUAGE - phrases that no native ${langName} speaker would ever write. Minor stylistic preferences do NOT count.
2. CLEAR REPETITIONS - the SAME idea stated twice in DIFFERENT blocks (not just similar topics). Within a single block, minor rephrasing is fine.
3. OBVIOUS FILLER - entire sentences that add zero information (e.g. "In this section we will discuss..."). Short transitional phrases are NOT filler.
4. FABRICATED CLAIMS - invented numbers, statistics, or counts not backed by sources (e.g. "34 Kriterien" but only 20 listed)${typeCheckRules}${styleCheckRules}

IMPORTANT:
- Lists and tables are GOOD — they show expertise. Do NOT flag them as problems.
- Bold text for key terms is GOOD. Do NOT flag it.
- Minor style preferences are NOT issues. Only flag things that would make a native reader cringe.
- An article that reads well overall should return an EMPTY ARRAY [].
- Return MAXIMUM 2 blocks — only the worst offenders. If nothing is truly bad, return [].
Return valid JSON array.`;

      const userPrompt = `Review this ${langName} article:

ARTICLE TYPE: ${articleType.toUpperCase()}${comment ? `\nSTYLE: ${comment}` : ''}

=== ARTICLE ===
${articleWithIds}

Return JSON array:
[{"blockId": <number>, "issues": ["specific issue"], "suggestion": "specific fix"}]

Empty array [] if perfect. ONLY JSON, no other text.`;

      const response = await this.chat(systemPrompt, userPrompt, 0.3);
      const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleanedResponse);
      if (Array.isArray(parsed)) {
        rhythmBlocksToFix = parsed;
      }
    } catch (error) {
      logger.error('Rhythm check failed', { error });
    }

    // Tolerance: 1 minor flag is acceptable — only fail if 2+ blocks flagged
    const rhythmCheck = {
      passed: rhythmBlocksToFix.length <= 1,
      blocksToFix: rhythmBlocksToFix,
    };

    // === Overall result ===
    const passed = wordCountCheck.passed && linkCountCheck.passed && linkQualityCheck.passed && keywordDensityCheck.passed && rhythmCheck.passed;

    logger.info(`Comprehensive review: ${passed ? 'PASSED' : 'FAILED'}`, {
      wordCount: `${actualWordCount} (${minWords}-${maxWords})`,
      links: `${presentUrls.length}/${configuredLinks.length}`,
      linkQuality: linkQualityIssues.length === 0 ? 'OK' : `${linkQualityIssues.length} issues`,
      mainKeywordCount: `${keywordCount}/${MAX_KEYWORD_OCCURRENCES}`,
      rhythmIssues: rhythmBlocksToFix.length,
    });

    return {
      passed,
      wordCountCheck,
      linkCountCheck,
      linkQualityCheck,
      keywordDensityCheck,
      rhythmCheck,
    };
  }

  /**
   * Smart trimming: AI decides which blocks to shorten and by how much
   * Sends entire article to AI, it returns per-block word targets
   */
  async smartTrimArticle(
    blocks: Array<{
      id: number;
      type: string;
      heading: string;
      content?: string;
    }>,
    currentWordCount: number,
    targetMaxWords: number,
    language: string
  ): Promise<Array<{ blockId: number; targetWords: number; reason: string }>> {
    const languageNames: Record<string, string> = {
      'en': 'English', 'de': 'German', 'ru': 'Russian', 'fr': 'French',
      'es': 'Spanish', 'it': 'Italian', 'pl': 'Polish', 'uk': 'Ukrainian',
      'nl': 'Dutch', 'pt': 'Portuguese',
    };
    const langName = languageNames[language] || 'English';
    const wordsToRemove = currentWordCount - targetMaxWords;

    const blocksInfo = blocks
      .filter(b => b.content && b.type !== 'h1')
      .map(b => {
        const words = b.content!.split(/\s+/).length;
        return `[BLOCK ${b.id}] ${b.type.toUpperCase()}: "${b.heading}" — ${words} words`;
      })
      .join('\n');

    const systemPrompt = `You are an expert ${langName} editor. The article is ${currentWordCount} words but must be max ${targetMaxWords} words. You need to remove ~${wordsToRemove} words total.

Analyze each block and decide which blocks can be shortened WITHOUT losing quality. Prioritize cutting:
1. Blocks with the most filler/padding/repetition
2. Blocks that are disproportionately long compared to their importance
3. Generic or less essential sections

PROTECT from cutting:
- Blocks with specific data, statistics, or expert information
- Introduction and conclusion (trim lightly at most)
- FAQ section

Return a JSON array of blocks to trim:
[{"blockId": <number>, "targetWords": <number>, "reason": "brief explanation"}]

The sum of words removed must be approximately ${wordsToRemove}. Only include blocks that need trimming.
Return ONLY valid JSON.`;

    const userPrompt = `Current article blocks:\n${blocksInfo}\n\nDecide which blocks to trim and by how much.`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.3);
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      logger.error('Smart trim failed, falling back to empty', { error });
    }
    return [];
  }

  /**
   * Fix a block's content based on identified issues
   * CRITICAL: Preserves all URLs/links from original content
   */
  async fixBlockContent(
    block: {
      id: number;
      type: string;
      heading: string;
      content: string;
    },
    issues: string[],
    suggestion: string,
    language: string,
    articleType: string = 'informational',
    comment?: string,
    maxWords?: number
  ): Promise<string> {
    const languageNames: Record<string, string> = {
      'en': 'English', 'de': 'German', 'ru': 'Russian', 'fr': 'French',
      'es': 'Spanish', 'it': 'Italian', 'pl': 'Polish', 'uk': 'Ukrainian',
      'nl': 'Dutch', 'pt': 'Portuguese',
    };
    const langName = languageNames[language] || 'English';

    // Build style instructions
    let styleInstructions = '';
    if (comment) {
      styleInstructions = `
5. Follow author's style instructions: ${comment}`;
    }

    // Build type instructions
    let typeInstructions = '';
    if (articleType === 'informational') {
      typeInstructions = `
6. INFORMATIONAL ARTICLE: Remove ANY commercial content, pricing, selling language`;
    } else if (articleType === 'commercial') {
      typeInstructions = `
6. COMMERCIAL ARTICLE: Keep pricing and commercial elements`;
    }

    const wordLimitRule = maxWords
      ? `2. HARD WORD LIMIT: Maximum ${maxWords} words. Being shorter is fine. Going over is NOT allowed.`
      : `2. Keep the same approximate length or SHORTER. Never make the text longer.`;

    const systemPrompt = `You are a professional editor improving article content.
Fix the issues while maintaining the original meaning and style.

CRITICAL RULES:
1. PRESERVE ALL LINKS - Any markdown links [text](url) MUST remain exactly as they are
${wordLimitRule}
3. Write in ${langName}
4. Return ONLY the improved content, no explanations
5. NEVER add new content, examples, or elaborations. Only FIX what is broken.${styleInstructions}${typeInstructions}`;

    const userPrompt = `Improve this block content:

=== BLOCK TYPE ===
${block.type}: ${block.heading}

=== CURRENT CONTENT ===
${block.content}

=== ISSUES TO FIX ===
${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

=== SUGGESTION ===
${suggestion}

IMPORTANT:
- Fix ONLY the issues listed above
- KEEP ALL LINKS EXACTLY AS THEY ARE: [text](url)
- Do NOT add new content or make the text longer
${maxWords ? `- HARD LIMIT: ${maxWords} words maximum` : '- Keep similar length or shorter'}
- Write in ${langName}

Return the improved content:`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.4);

      // Clean up response
      let fixedContent = response.trim();
      fixedContent = fixedContent.replace(/^```(?:markdown|md)?\n?/gm, '').replace(/\n?```$/gm, '');

      logger.debug(`Fixed block ${block.id}`, {
        originalLength: block.content.length,
        fixedLength: fixedContent.length,
      });

      return fixedContent;

    } catch (error) {
      logger.error(`Failed to fix block ${block.id}`, { error });
      // Return original content on error
      return block.content;
    }
  }

  /**
   * Generate SEO title and description for the article
   */
  async generateSeoMetadata(
    article: string,
    mainKeyword: string,
    language: string,
    articleType: string = 'informational',
    comment?: string
  ): Promise<{ title: string; description: string }> {
    const languageNames: Record<string, string> = {
      'en': 'English', 'de': 'German', 'ru': 'Russian', 'fr': 'French',
      'es': 'Spanish', 'it': 'Italian', 'pl': 'Polish', 'uk': 'Ukrainian',
      'nl': 'Dutch', 'pt': 'Portuguese',
    };
    const langName = languageNames[language] || 'English';

    // Build type-specific instructions
    let typeHint = '';
    if (articleType === 'informational') {
      typeHint = `
- INFORMATIONAL article: Focus on education, learning, information value`;
    } else if (articleType === 'commercial') {
      typeHint = `
- COMMERCIAL article: Include conversion elements, urgency, benefits`;
    }

    // Build style hint from comment
    let styleHint = '';
    if (comment) {
      styleHint = `
- Follow author's tone/style: ${comment.substring(0, 200)}`;
    }

    const systemPrompt = `You are an SEO expert creating metadata for articles.
Generate optimized title and description that will rank well in search engines.

Rules:
- Write in ${langName}
- Include the main keyword naturally
- Title: max 60 characters, compelling, click-worthy
- Description: max 160 characters, includes call-to-action, summarizes value${typeHint}${styleHint}
- Return valid JSON only`;

    const userPrompt = `Generate SEO metadata for this article.

Main keyword: "${mainKeyword}"

=== ARTICLE (first 2000 chars) ===
${article.substring(0, 2000)}

Return JSON:
{
  "title": "SEO title here (max 60 chars)",
  "description": "Meta description here (max 160 chars)"
}

Return ONLY the JSON, no other text.`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.5);

      // Parse JSON response
      const cleanedResponse = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const seo = JSON.parse(cleanedResponse);

      // Validate and truncate if needed
      const title = (seo.title || mainKeyword).substring(0, 60);
      const description = (seo.description || `Learn about ${mainKeyword}`).substring(0, 160);

      logger.info(`Generated SEO metadata: title=${title.length} chars, desc=${description.length} chars`);

      return { title, description };

    } catch (error) {
      logger.error('Failed to generate SEO metadata', { error });
      // Return fallback
      return {
        title: mainKeyword.substring(0, 60),
        description: `Comprehensive guide about ${mainKeyword}`.substring(0, 160),
      };
    }
  }

}
