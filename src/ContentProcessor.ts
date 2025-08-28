import { type AppleAPIResponse, type DocumentContent } from './types/index.js';

class ContentProcessor {
  private static readonly BASE_URL = 'https://developer.apple.com' as const;

  processDocument(docData: AppleAPIResponse): DocumentContent {
    const { titles, content } = this.cleanAndSeparateContent(docData);
    const extractedUrls = this.extractAllUrls(docData);

    return {
      title: titles.trim() || null,
      content: this.normalizeLineTerminators(content),
      extractedUrls,
    };
  }

  private cleanAndSeparateContent(docData: AppleAPIResponse): { titles: string; content: string } {
    const titles = this.extractTitleContent(docData);
    const content = this.extractMainContent(docData);
    return { titles, content };
  }

  private extractTitleContent(docData: AppleAPIResponse): string {
    const parts = [];

    // Combine roleHeading and title for better readability
    if (docData.metadata.roleHeading && docData.metadata.title) {
      parts.push(`${docData.metadata.roleHeading}: ${docData.metadata.title}`);
    } else if (docData.metadata.title) {
      parts.push(docData.metadata.title);
    } else if (docData.metadata.roleHeading) {
      parts.push(docData.metadata.roleHeading);
    }

    // Add abstract as description
    if (docData.abstract?.length && docData.abstract.length > 0) {
      const abstractText = docData.abstract.map((item) => item.text).join('');
      if (abstractText.trim()) {
        parts.push(`\n${abstractText}`);
      }
    }

    // Add platform information with clear formatting
    if (docData.metadata.platforms?.length && docData.metadata.platforms.length > 0) {
      const platformInfo = docData.metadata.platforms
        .map((platform) => this.formatPlatformInfo(platform))
        .filter((info) => info.trim())
        .join(', ');
      if (platformInfo) {
        parts.push(`\nPlatforms: ${platformInfo}`);
      }

      // Collect unique deprecation messages
      const deprecationMessages = new Set<string>();
      docData.metadata.platforms.forEach((platform: any) => {
        if ((platform.deprecated || platform.deprecatedAt) && platform.message) {
          deprecationMessages.add(platform.message);
        }
      });

      // Add deprecation note if there are any messages
      if (deprecationMessages.size > 0) {
        const messages = Array.from(deprecationMessages).join('; ');
        parts.push(`\nDeprecation Note: ${messages}`);
      }
    }

    return parts.join('') + '\n';
  }

  private formatPlatformInfo(platform: any): string {
    // Handle special case: deprecated item without name (global deprecation)
    if (!platform.name && platform.deprecated) {
      const message = platform.message ? ` (${platform.message})` : '';
      return `Deprecated${message}`;
    }

    // Skip items without name that aren't deprecated
    if (!platform.name) {
      return '';
    }

    // Handle version information
    let version = '';
    if (platform.deprecatedAt && platform.introducedAt) {
      version = `${platform.introducedAt}–${platform.deprecatedAt} deprecated`;
    } else if (platform.introducedAt) {
      version = `${platform.introducedAt}+`;
    } else if (platform.deprecated) {
      version = 'deprecated';
    }

    const beta = platform.beta ? ' [Beta]' : '';

    return `${platform.name}${version ? ' ' + version : ''}${beta}`;
  }

  private extractMainContent(docData: AppleAPIResponse): string {
    if (!docData.primaryContentSections?.length) return '';

    const content = docData.primaryContentSections
      .map((section) => this.convertContentSectionToMarkdown(section, docData.references || {}, 0))
      .filter((result) => result.content)
      .map((result) => result.content)
      .join('\n');

    return this.normalizeLineTerminators(content);
  }

  private convertContentSectionToMarkdown(
    section: any,
    references: Record<string, any>,
    indentLevel: number
  ): { title: string; content: string } {
    const sectionType = section.type || section.kind;

    if (!sectionType) {
      return { title: '', content: '' };
    }

    const handlers: Record<string, () => { title: string; content: string }> = {
      heading: () => this.renderHeading(section),
      paragraph: () => this.renderParagraph(section, references),
      row: () => this.renderTableRow(section, references, indentLevel),
      unorderedList: () => this.renderList(section, references, indentLevel, 'unordered'),
      orderedList: () => this.renderList(section, references, indentLevel, 'ordered'),
      codeListing: () => this.renderCodeListing(section),
      declarations: () => this.renderDeclarations(section),
      properties: () => this.renderProperties(section, references),
      parameters: () => this.renderParameters(section, references)
    };

    return handlers[sectionType]?.() || this.renderGenericContent(section, references, indentLevel);
  }

  private renderHeading(section: any): { title: string; content: string } {
    const level = section.level || 2;
    const headingPrefix = '#'.repeat(level);
    const title = section.text || '';
    const content = `${headingPrefix} ${section.text}`;
    return { title, content };
  }

  private renderParagraph(
    section: any,
    references: Record<string, any>
  ): { title: string; content: string } {
    let content = '';
    if (section.inlineContent) {
      content = section.inlineContent
        .map((inline: any) => this.renderInlineContent(inline, references))
        .join('');
    }
    return { title: '', content };
  }

  private renderCodeListing(section: any): { title: string; content: string } {
    if (!section.code?.length) {
      return { title: '', content: '' };
    }

    const language = section.syntax || '';
    const content = `\`\`\`${language}\n${section.code.join('\n')}\n\`\`\``;
    return { title: '', content };
  }

  private renderList(
    section: any,
    references: Record<string, any>,
    indentLevel: number,
    listType: 'ordered' | 'unordered'
  ): { title: string; content: string } {
    let content = '';
    if (!section.items) {
      return { title: '', content };
    }

    if (indentLevel > 10) {
      return { title: '', content };
    }

    section.items.forEach((item: any, index: number) => {
      if (item.content) {
        const indent = '  '.repeat(indentLevel);
        const marker = listType === 'ordered' ? `${index + 1}. ` : '- ';
        content += `${indent}${marker}`;

        let isFirstContent = true;
        item.content.forEach((contentItem: any, contentIndex: number) => {
          const result = this.convertContentSectionToMarkdown(
            contentItem,
            references,
            indentLevel + 1
          );
          if (result.content) {
            if (this.isNestedList(contentItem)) {
              if (!isFirstContent) {
                content += '\n';
              }
              content += result.content;
            } else {
              const cleanContent = this.cleanContent(result.content);
              content += cleanContent;

              if (contentIndex < item.content.length - 1) {
                content += '\n';
              }
            }
            isFirstContent = false;
          }
        });

        content += '\n';
      }
    });

    if (indentLevel === 0) {
      content += '\n';
    }

    return { title: '', content };
  }

  private isNestedList(contentItem: any): boolean {
    return (
      contentItem.type === 'unorderedList' ||
      contentItem.kind === 'unorderedList' ||
      contentItem.type === 'orderedList' ||
      contentItem.kind === 'orderedList'
    );
  }

  private cleanContent(content: string): string {
    return this.normalizeLineTerminators(content)
      .replace(/^#+\s*/, '')
      .replace(/\n+$/, '');
  }

  private renderInlineContent(inline: any, references: Record<string, any>): string {
    const handlers: Record<string, () => string> = {
      text: () => this.normalizeLineTerminators(inline.text || ''),
      reference: () => this.renderReference(inline, references),
      codeVoice: () => (inline.code ? `\`${this.normalizeLineTerminators(inline.code)}\`` : ''),
      image: () => this.renderMedia(inline, 'Image'),
      video: () => this.renderMedia(inline, 'Video'),
    };

    return handlers[inline.type]?.() || '';
  }

  private renderReference(inline: any, references: Record<string, any>): string {
    const refText =
      inline.identifier && references[inline.identifier]
        ? references[inline.identifier].title || inline.text || inline.identifier
        : inline.text || inline.identifier || '';

    return refText ? `\`${refText}\`` : '';
  }

  private renderMedia(inline: any, mediaType: string): string {
    const abstractText = inline.metadata?.abstract?.map((item: any) => item.text || '').join('');

    return abstractText ? `[${mediaType}: ${abstractText}]` : '';
  }

  private extractAllUrls(docData: AppleAPIResponse): string[] {
    if (!docData.references) return [];

    return [
      ...new Set(
        Object.values(docData.references)
          .filter((ref) => ref?.url)
          .map((ref) => (ref.url!.startsWith('http') ? ref.url! : `${ContentProcessor.BASE_URL}${ref.url}`))
          .filter(
            (url) =>
              url.startsWith('https://developer.apple.com/documentation') ||
              url.startsWith('https://developer.apple.com/design')
          )
      ),
    ];
  }

  private renderTableRow(
    section: any,
    references: Record<string, any>,
    indentLevel: number
  ): { title: string; content: string } {
    let title = '';
    let content = '';
    if (section.columns) {
      section.columns.forEach((column: any) => {
        if (column.content) {
          column.content.forEach((contentItem: any) => {
            const result = this.convertContentSectionToMarkdown(
              contentItem,
              references,
              indentLevel
            );
            if (result.title) title += result.title + '\n';
            if (result.content) content += result.content;
          });
        }
      });
    }
    return { title, content };
  }

  private renderDeclarations(section: any): { title: string; content: string } {
    let content = '';
    if (section.declarations && section.declarations.length > 0) {
      section.declarations.forEach((declaration: any) => {
        if (declaration.tokens && declaration.tokens.length > 0) {
          const languages = declaration.languages || [];
          const formattedDeclaration = this.formatFunctionDeclaration(declaration.tokens, languages);
          if (formattedDeclaration.trim()) {
            content += `\`\`\`\n${formattedDeclaration}\n\`\`\`\n`;
          }
        }
      });
    }
    return { title: '', content };
  }

  private formatFunctionDeclaration(tokens: any[], languages: string[]): string {
    // Get the raw declaration text
    const rawText = tokens.map((token: any) => token.text || '').join('');

    // Check if this is a Swift function based on languages array
    const isSwiftFunction = languages.includes('swift');

    if (isSwiftFunction) {
      // Use multi-line format for Swift functions
      return this.formatSwiftFunction(rawText);
    } else {
      // Use single-line format for C/C++/Objective-C functions
      return rawText;
    }
  }

  private formatSwiftFunction(rawText: string): string {
    const parts = rawText.split('(');
    if (parts.length < 2) return rawText;

    const funcPart = parts[0]; // "func isValid"
    const remaining = parts.slice(1).join('('); // everything after first (

    const closingParenIndex = remaining.lastIndexOf(')');
    if (closingParenIndex === -1) return rawText;

    const paramsPart = remaining.substring(0, closingParenIndex);
    const returnPart = remaining.substring(closingParenIndex); // ") -> Bool"

    // Split parameters by comma, but be careful with nested types
    const params = this.splitParameters(paramsPart);

    let result = funcPart + '(\n';
    params.forEach((param, index) => {
      const trimmedParam = param.trim();
      if (trimmedParam) {
        result += `  ${trimmedParam}`;
        if (index < params.length - 1) {
          result += ',';
        }
        result += '\n';
      }
    });
    result += returnPart;

    return result;
  }

  private splitParameters(paramString: string): string[] {
    const params: string[] = [];
    let current = '';
    let depth = 0;

    for (let i = 0; i < paramString.length; i++) {
      const char = paramString[i];

      if (char === '(' || char === '[' || char === '<') {
        depth++;
      } else if (char === ')' || char === ']' || char === '>') {
        depth--;
      } else if (char === ',' && depth === 0) {
        if (current.trim()) {
          params.push(current.trim());
        }
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      params.push(current.trim());
    }

    return params;
  }

  private renderProperties(
    section: any,
    references: Record<string, any>
  ): { title: string; content: string } {
    let content = '';
    if (section.title) {
      content += `### ${section.title}\n\n`;
    }

    if (section.items && section.items.length > 0) {
      section.items.forEach((item: any) => {
        if (item.name) {
          const propertyHeader = this.buildPropertyHeader(item);
          content += `${propertyHeader}\n\n`;

          if (item.content && item.content.length > 0) {
            item.content.forEach((contentItem: any) => {
              const result = this.convertContentSectionToMarkdown(contentItem, references, 0);
              if (result.content) {
                content += result.content;
              }
            });
          }

          content += '\n';
        }
      });
    }
    return { title: '', content };
  }

  private buildPropertyHeader(item: any): string {
    let propertyHeader = `#### ${item.name}`;

    if (item.type && item.type.length > 0) {
      const typeText = item.type.map((t: any) => t.text || '').join('');
      if (typeText) {
        propertyHeader += ` (${typeText})`;
      }
    }

    const statusParts = [];
    if (item.required) {
      statusParts.push('Required');
    }
    if (item.deprecated) {
      statusParts.push('Deprecated');
    }

    if (statusParts.length > 0) {
      propertyHeader += ` [${statusParts.join(', ')}]`;
    }

    return propertyHeader;
  }

  private renderGenericContent(
    section: any,
    references: Record<string, any>,
    indentLevel: number
  ): { title: string; content: string } {
    let title = '';
    let content = '';

    if (section.content) {
      section.content.forEach((contentItem: any) => {
        const result = this.convertContentSectionToMarkdown(contentItem, references, indentLevel);
        if (result.title) title += result.title + '\n';
        if (result.content) content += result.content + '\n';
      });
    }

    return { title, content };
  }

  private renderParameters(
    section: any,
    references: Record<string, any>
  ): { title: string; content: string } {
    if (!section.parameters?.length) {
      return { title: '', content: '' };
    }

    let content = '## Parameters\n';

    section.parameters.forEach((param: any) => {
      if (param.name) {
        content += `\`${param.name}\`\n`;

        if (param.content?.length) {
          param.content.forEach((contentItem: any) => {
            const result = this.convertContentSectionToMarkdown(contentItem, references, 0);
            if (result.content) {
              content += `  ${result.content}\n`;
            }
          });
        }
      }
    });

    return { title: '', content };
  }

  private normalizeLineTerminators(text: string): string {
    return text.replace(/[\u2028\u2029]/g, '\n');
  }
}

export { ContentProcessor };
