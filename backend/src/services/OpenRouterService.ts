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
    comment?: string
  ): Promise<StructureAnalysis> {
    // Calculate average word count
    const wordCounts = serpResults
      .filter(r => r.wordCount && r.wordCount > 0)
      .map(r => r.wordCount!);
    const averageWordCount = wordCounts.length > 0
      ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length)
      : 2000;

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
Average competitor word count: ${averageWordCount}
Article type: ${articleType}${comment ? `\n\nAUTHOR'S INSTRUCTIONS:\n${comment}` : ''}

CRITICAL H1 ANALYSIS TASK:
1. Examine ALL competitor H1 titles from above
2. Identify what makes them strong or weak
3. Create a COMPETITIVE H1 that:
   - Is MORE specific, compelling, or comprehensive than competitors
   - Includes main keyword "${mainKeyword}" naturally
   - Is 50-70 characters for SEO
   - Stands out and makes users want to click
   - Example patterns: "Ultimate Guide", "Complete Tutorial", "Expert Tips", specific numbers, unique angles

TARGET: Create a focused 1500-2000 word article (6-9 content blocks, NO bloat or filler).
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
2. Block id=0 is H1 - Analyze competitor H1 titles and create a COMPETITIVE, UNIQUE title that:
   - Is better than competitors (more specific, compelling, or comprehensive)
   - Includes main keyword naturally
   - Is 50-70 characters for optimal SEO
   - NO questions in H1 block
3. Block id=1 is always Introduction - heading MUST be EMPTY STRING "" (no "Einleitung"/"Introduction" heading!)
4. Second-to-last block must be Conclusion (no questions)
5. Last block must be FAQ (no questions), MAX 4-5 Q&A pairs, short and concise
6. Content blocks (h2, h3) should have "questions" array with 0-5 SIMPLE research questions
7. CRITICAL: Include 6-9 content blocks total (NOT 10-15) for focused, high-quality coverage
   - Quality over quantity
   - Each block covers essential subtopics only
   - Avoid redundant or filler sections
8. Each block should have 3-8 LSI keywords relevant to that section
9. TARGET ARTICLE LENGTH: 1500-2000 words total (compact, focused, no bloat)

CRITICAL - Question Generation Rules:
- Questions MUST be SHORT and SIMPLE (max 10 words)
- Questions should ask about ONE specific thing, not multiple
- Good examples: "What is X?", "How much does X cost?", "What are the types of X?", "How does X work?"
- BAD examples: "What are the challenges and opportunities in X considering various factors?"
- NOT every block needs questions - some blocks might have 0-2, others 3-5
- Questions should help find FACTS: prices, definitions, statistics, names, dates
- Avoid academic, philosophical, or multi-part questions`;

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

      // Ensure H1 block has no questions
      const h1Block = analysis.recommendedStructure.find(b => b.type === 'h1');
      if (h1Block) {
        delete h1Block.questions;
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
3. For content blocks (h2/h3 only): generate 0-5 SIMPLE research questions

CRITICAL - Question Rules:
- Questions MUST be SHORT (max 8-10 words)
- Ask about ONE specific thing only
- Good: "What is X?", "How much does X cost?", "What are types of X?"
- BAD: "What challenges arise when implementing X in various contexts?"
- NOT every block needs questions (some have 0, others have 3-5)
- Questions should find FACTS: prices, definitions, stats, names
- NO academic, multi-part, or philosophical questions

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

      // Validate and clean up blocks
      return enrichedBlocks.map((block, idx) => ({
        ...block,
        id: idx,
        questions: ['intro', 'conclusion', 'faq', 'h1'].includes(block.type)
          ? undefined
          : block.questions,
      }));
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
        blockTypeInstructions = `Write an engaging introduction paragraph.
- Hook the reader immediately
- Introduce the topic and its importance
- Preview what the article will cover
- Include the main keyword naturally
- 100-150 words (concise and focused)`;
        estimatedWords = 125;
        break;

      case 'h2':
      case 'h3':
        // For 1500-2000 word articles with 6-9 content blocks
        // Calculation: (1800 target - 400 for intro/conclusion/faq) / 7 blocks = ~200 words
        const wordsPerBlock = Math.round((targetWordCount - 400) / 7);
        estimatedWords = Math.max(150, Math.min(250, wordsPerBlock));
        blockTypeInstructions = `Write focused, high-quality content for this section.
- Start directly with the content (heading is already defined)
- Use paragraphs, bullet lists, or numbered lists as appropriate
- Include tables if data comparison is relevant
- ${estimatedWords}-${estimatedWords + 50} words (concise, NO filler)
- Use the LSI keywords naturally throughout
- Every sentence must add value - no padding or repetition
${hasFactsFromResearch ? '- MUST include the verified facts provided above' : '- Write informatively but avoid specific statistics, research citations, or precise numbers you cannot verify'}`;
        break;

      case 'conclusion':
        blockTypeInstructions = `Write a strong, concise conclusion.
- Summarize the key points covered
- Reinforce the main message
- End with a call to action or final thought
- 80-120 words (brief and impactful)`;
        estimatedWords = 100;
        break;

      case 'faq':
        blockTypeInstructions = `Generate EXACTLY 4 FAQ items. NO MORE than 4!
Format each as:
**Q: [Short practical question]**
A: [Concise answer - 1-2 sentences MAX]

RULES:
- Questions must be SHORT and practical (not academic)
- Answers must be CONCISE (1-2 sentences, ~25-40 words each)
- Focus on real user concerns and pain points
- Total FAQ section: 120-180 words max`;
        estimatedWords = 150;
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

    const systemPrompt = `You are an expert SEO content writer creating high-quality article content in ${langName}.
${styleRules}
CRITICAL RULES:
1. Write ONLY in ${langName} language
2. Match the style and tone of the previous content for consistency
3. Do NOT invent statistics, research findings, or specific numbers unless provided in VERIFIED FACTS
4. Use natural, engaging prose - not robotic or overly formal
5. Incorporate LSI keywords naturally, don't force them
6. Do NOT add the heading - just write the content for this section
7. Format with markdown where appropriate (lists, bold, tables)${typeRules}`;

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
MAIN KEYWORD: ${mainKeyword}
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
   * Insert link(s) into block content
   * AI adapts the text to naturally incorporate the links
   * BUT anchor text is NEVER changed - use exactly as provided
   *
   * For anchorless links, anchor = URL (e.g. [https://url/](https://url/))
   */
  async insertLinksIntoBlock(
    blockContent: string,
    blockHeading: string,
    links: Array<{
      url: string;
      anchor: string; // EXACT anchor to use, never change
      displayType: 'inline' | 'list_end' | 'list_start' | 'sidebar';
    }>,
    language: string
  ): Promise<string> {
    const languageNames: Record<string, string> = {
      'en': 'English', 'de': 'German', 'ru': 'Russian', 'fr': 'French',
      'es': 'Spanish', 'it': 'Italian', 'pl': 'Polish', 'uk': 'Ukrainian',
      'nl': 'Dutch', 'pt': 'Portuguese',
    };
    const langName = languageNames[language] || 'English';

    // Build links description
    const linksDescription = links.map((link, i) => {
      const linkMarkdown = `[${link.anchor}](${link.url})`;
      let instruction = '';

      switch (link.displayType) {
        case 'inline':
          instruction = 'Insert INLINE - adapt a sentence to naturally include this link';
          break;
        case 'list_start':
          instruction = 'Add at START - create 1-2 intro sentences with this link';
          break;
        case 'list_end':
          instruction = 'Add at END - create 1-2 closing sentences with this link';
          break;
        case 'sidebar':
          instruction = 'Add at END as: **Siehe auch:** ' + linkMarkdown;
          break;
      }

      return `${i + 1}. ${linkMarkdown}\n   Type: ${link.displayType}\n   Instruction: ${instruction}`;
    }).join('\n\n');

    const systemPrompt = `You are a markdown editor inserting internal links into content.

CRITICAL RULES:
1. Use the EXACT link markdown provided - DO NOT change anchor text or URL
2. The content is MARKDOWN - preserve ALL formatting (bold, lists, etc.)
3. Adapt the text minimally to fit the links naturally
4. Write in ${langName}
5. Return ONLY the updated content, no explanations`;

    const userPrompt = `Insert these links into the content:

=== BLOCK HEADING ===
${blockHeading}

=== CURRENT CONTENT ===
${blockContent}

=== LINKS TO INSERT (use EXACTLY as shown) ===
${linksDescription}

IMPORTANT:
- Use the EXACT markdown links shown above
- Do NOT change anchor text or URL
- Adapt surrounding text if needed to make links fit naturally
- Keep all existing markdown formatting

Return the updated content:`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.4);

      // Clean up response
      let updatedContent = response.trim();
      updatedContent = updatedContent.replace(/^```(?:markdown|md)?\n?/gm, '').replace(/\n?```$/gm, '');

      // Verify all links were inserted - check for the full markdown link format
      const missingLinks: typeof links = [];
      for (const link of links) {
        // Check for the exact markdown link format: [anchor](url)
        const expectedLink = `[${link.anchor}](${link.url})`;
        // Also check for URL with/without trailing slash
        const urlVariants = [
          link.url,
          link.url.endsWith('/') ? link.url.slice(0, -1) : link.url + '/',
        ];

        const found = urlVariants.some(url => updatedContent.includes(url));

        if (!found) {
          logger.warn(`Link not found in AI response: ${expectedLink}`);
          missingLinks.push(link);
        } else {
          logger.debug(`Link verified in response: ${link.url}`);
        }
      }

      // Force-append missing links
      if (missingLinks.length > 0) {
        logger.warn(`${missingLinks.length}/${links.length} links missing from AI response, force-appending`);
        for (const link of missingLinks) {
          const linkMarkdown = `[${link.anchor}](${link.url})`;
          updatedContent += `\n\n${linkMarkdown}`;
          logger.info(`Force-appended: ${linkMarkdown}`);
        }
      }

      logger.debug(`Links insertion complete`, {
        requested: links.length,
        missing: missingLinks.length,
        originalLength: blockContent.length,
        newLength: updatedContent.length,
      });

      return updatedContent;
    } catch (error) {
      logger.error('Failed to insert links into block', { error });
      // Fallback: append all links at the end
      let fallback = blockContent;
      for (const link of links) {
        const linkMarkdown = `[${link.anchor}](${link.url})`;
        fallback += `\n\n${linkMarkdown}`;
        logger.info(`Fallback-appended: ${linkMarkdown}`);
      }
      return fallback;
    }
  }

  /**
   * Review article quality and identify blocks that need improvement
   * Checks for: rhythm, filler content (water), repetitions, anomalies, hallucinations
   *
   * @returns Array of blocks with issues and suggestions for improvement
   */
  async reviewArticleQuality(
    blocks: Array<{
      id: number;
      type: 'h1' | 'intro' | 'h2' | 'h3' | 'conclusion' | 'faq';
      heading: string;
      content?: string;
    }>,
    language: string,
    articleType: string = 'informational',
    comment?: string
  ): Promise<Array<{
    blockId: number;
    issues: string[];
    suggestion: string;
  }>> {
    const languageNames: Record<string, string> = {
      'en': 'English', 'de': 'German', 'ru': 'Russian', 'fr': 'French',
      'es': 'Spanish', 'it': 'Italian', 'pl': 'Polish', 'uk': 'Ukrainian',
      'nl': 'Dutch', 'pt': 'Portuguese',
    };
    const langName = languageNames[language] || 'English';

    // Build article representation with block IDs
    const articleWithIds = blocks
      .filter(b => b.content)
      .map(b => `[BLOCK ${b.id}] ${b.type.toUpperCase()}: ${b.heading}\n${b.content}`)
      .join('\n\n---\n\n');

    // Build type-specific check instructions
    let typeCheckRules = '';
    if (articleType === 'informational') {
      typeCheckRules = `
6. COMMERCIAL CONTAMINATION - if this is INFORMATIONAL article, flag ANY commercial content:
   - Pricing mentions, cost comparisons
   - Calls to buy/order/purchase
   - Service promotions, selling language
   - These MUST be flagged and removed!
`;
    } else if (articleType === 'commercial') {
      typeCheckRules = `
6. MISSING COMMERCIAL ELEMENTS - if this is COMMERCIAL article, note if:
   - Pricing info is missing where expected
   - No clear calls to action
`;
    }

    // Build style check from comment
    let styleCheckRules = '';
    if (comment) {
      styleCheckRules = `
7. STYLE COMPLIANCE - check if content follows author's instructions:
   "${comment}"
   Flag blocks that violate these instructions.
`;
    }

    const systemPrompt = `You are a professional editor reviewing an article for quality issues.
Your task is to identify blocks that need improvement and provide specific suggestions.

Check for:
1. RHYTHM - unnatural sentence flow, monotonous structure
2. WATER (filler) - unnecessary words, redundant phrases, padding
3. REPETITIONS - repeated words/phrases across blocks
4. ANOMALIES - inconsistent tone, style breaks
5. HALLUCINATIONS - claims that seem unsupported or suspicious${typeCheckRules}${styleCheckRules}

IMPORTANT:
- Return ONLY blocks that have REAL issues
- Be specific about what's wrong
- Provide actionable suggestions
- Return valid JSON array`;

    const userPrompt = `Review this ${langName} article and identify blocks that need improvement.
Each block is marked with [BLOCK X] where X is the block ID.

ARTICLE TYPE: ${articleType.toUpperCase()}${comment ? `\nAUTHOR'S STYLE INSTRUCTIONS: ${comment}` : ''}

=== ARTICLE ===
${articleWithIds}

Return a JSON array of objects with this structure:
[
  {
    "blockId": <number>,
    "issues": ["issue1", "issue2"],
    "suggestion": "specific suggestion for improvement"
  }
]

If the article is perfect, return an empty array: []
Return ONLY the JSON array, no other text.`;

    try {
      const response = await this.chat(systemPrompt, userPrompt, 0.3);

      // Parse JSON response
      const cleanedResponse = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const issues = JSON.parse(cleanedResponse);

      if (!Array.isArray(issues)) {
        logger.warn('AI returned non-array response for review, returning empty');
        return [];
      }

      logger.info(`Article review found ${issues.length} blocks with issues`);
      return issues;

    } catch (error) {
      logger.error('Failed to review article quality', { error });
      return [];
    }
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
    comment?: string
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

    const systemPrompt = `You are a professional editor improving article content.
Fix the issues while maintaining the original meaning and style.

CRITICAL RULES:
1. PRESERVE ALL LINKS - Any markdown links [text](url) MUST remain exactly as they are
2. Keep the same approximate length
3. Write in ${langName}
4. Return ONLY the improved content, no explanations${styleInstructions}${typeInstructions}`;

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
- Fix the issues listed above
- KEEP ALL LINKS EXACTLY AS THEY ARE: [text](url)
- Maintain similar length and structure
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

  /**
   * Generate improvement tasks for blocks when no issues are found
   * Used to ensure we always improve at least some blocks
   */
  generateImprovementTasks(
    blocks: Array<{ id: number; type: string; heading: string; content?: string }>,
    count: number
  ): Array<{ blockId: number; issues: string[]; suggestion: string }> {
    // Filter content blocks (not h1/faq)
    const contentBlocks = blocks.filter(
      b => b.content && b.type !== 'h1' && b.type !== 'faq'
    );

    if (contentBlocks.length === 0) return [];

    // Select random blocks
    const selectedBlocks = contentBlocks
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(count, contentBlocks.length));

    return selectedBlocks.map(block => ({
      blockId: block.id,
      issues: ['General readability improvement'],
      suggestion: 'Improve flow and clarity while maintaining the message',
    }));
  }
}
