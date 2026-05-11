const vscode = require('vscode');

/**
 * Finds the index of the first comment character (';' or '#') that is
 * outside of a string literal. Returns -1 if none found.
 */
function findCommentStart(text) {
    let inString = false;
    let stringChar = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if ((char === "'" || char === '"') && (i === 0 || text[i - 1] !== '\\')) {
            if (!inString) {
                inString = true;
                stringChar = char;
            } else if (stringChar === char) {
                inString = false;
            }
        }
        if ((char === ';' || char === '#') && !inString) {
            return i;
        }
    }
    return -1;
}

function formatAsmLine(line) {
    let text = line.trim();
    if (!text) return '';

    // Capture the exact leading whitespace the user typed
    const leadingWhitespaceMatch = line.match(/^[ \t]*/);
    const originalIndent = leadingWhitespaceMatch ? leadingWhitespaceMatch[0] : '';

    // Pass through full-line comments while preserving their original indentation
    if (text.startsWith(';') || text.startsWith('#')) {
        return '\x00' + text;
    }

    let comment = '';
    let codePart = text;

    // 1. Safely extract comment (ignoring comment chars inside strings)
    const commentIdx = findCommentStart(text);
    if (commentIdx !== -1) {
        comment = text.slice(commentIdx).trim();
        codePart = text.slice(0, commentIdx).trim();
    }

    if (!codePart) {
        return originalIndent + comment;
    }

    const tokenRegex = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
    const tokens = codePart.match(tokenRegex) || [];

    // 2. BYPASS LOGIC: Identify Structural code, macros, flow control, and CONSTANTS
    const bypassDirectives = /^(section|segment|format|include|global|extern|entry|macro|end|struc|virtual|align|public|use16|use32|use64|bits|org|if|else|elseif|end\s*if|while|end\s*w|repeat|until|%include|%define|%macro|%endmacro|%ifdef|%ifndef|%endif|%else|%elif|#define|#include|#ifdef|#ifndef|#endif|#else|#elif)$/i;
    
    // Check if the line contains an '=' outside of a string literal
    const hasEquals = tokens.some(t => t.includes('=') && !t.startsWith('"') && !t.startsWith("'"));

    const isBypass = (tokens.length > 0 && bypassDirectives.test(tokens[0])) || 
                     (tokens.length > 1 && /^(macro|struc|struct)$/i.test(tokens[1])) ||
                     hasEquals; 

    if (isBypass) {
        let formattedLine = originalIndent + codePart; 
        
        // Comment alignment is handled externally by the group-alignment pass;
        // just attach it with a placeholder sentinel so the caller can replace it.
        if (comment) {
            formattedLine += '\x00' + comment;
        }
        return formattedLine.trimEnd();
    }

    // 3. STANDARD ASM PARSING
    let label = '';
    let instruction = '';
    let operands = '';
    let tokenIdx = 0;

    const dataDirectives = /^(db|dw|dd|dq|dt|resb|resw|resd|resq|rb|rw|rd|rq|equ)$/i;

    // Identify Label
    if (tokens[tokenIdx].endsWith(':')) {
        label = tokens[tokenIdx];
        tokenIdx++;
    } else if (tokens.length > 1 && dataDirectives.test(tokens[1])) {
        label = tokens[0]; 
        tokenIdx++;
    }

    // Identify Instruction
    if (tokenIdx < tokens.length) {
        instruction = tokens[tokenIdx].toLowerCase(); 
        tokenIdx++;
    }

    // Identify Operands
    if (tokenIdx < tokens.length) {
        let instrWord = tokens[tokenIdx - 1];
        let instrPos = codePart.indexOf(instrWord);
        let operandsStart = instrPos + instrWord.length;
        let rawOperands = codePart.substring(operandsStart).trim();

        let formattedOperands = '';
        let inQuotes = false;
        let quoteCh = '';
        let currentOp = '';
        
        for (let i = 0; i < rawOperands.length; i++) {
            let char = rawOperands[i];
            if ((char === "'" || char === '"') && (i === 0 || rawOperands[i - 1] !== '\\')) {
                if (!inQuotes) {
                    inQuotes = true;
                    quoteCh = char;
                } else if (quoteCh === char) {
                    inQuotes = false;
                }
            }
            
            if (char === ',' && !inQuotes) {
                formattedOperands += currentOp.trim() + ', ';
                currentOp = '';
            } else {
                currentOp += char;
            }
        }
        formattedOperands += currentOp.trim();
        operands = formattedOperands;
    }

    // 4. Standard Output Construction
    let formattedLine = '';

    if (label) {
        // Guarantee at least one space if the label overflows the 16-character column
        if (label.length >= 16) {
            formattedLine += label + ' '; 
        } else {
            formattedLine += label.padEnd(16, ' '); 
        }
    } else {
        formattedLine += '\t';
    }

    if (instruction) {
        formattedLine += instruction.padEnd(8, ' ');
        if (operands) {
            formattedLine += operands;
        }
    }

    // Attach comment with sentinel — replaced by group-alignment pass
    if (comment) {
        formattedLine += '\x00' + comment;
    }

    return formattedLine.trimEnd();
}

/**
 * Measures the visual length of the code portion of a line (before the sentinel).
 * Tabs count as 4 spaces.
 */
function visualLength(text) {
    return text.replace(/\t/g, '    ').length;
}

/**
 * Takes an array of already-formatted lines (with \x00 sentinel before each
 * inline comment) and rewrites them so that comments within each group are
 * aligned to the same column.
 *
 * GROUP RULES:
 *   - A group is a maximal consecutive run of lines that ALL carry a sentinel.
 *   - Any line without a sentinel (blank, code-only, full-line comment) breaks
 *     the group. This means two commented lines separated by even one
 *     uncommented line are in different groups with independent columns.
 *
 * COLUMN RULES:
 *   - commentCol = maxCodeLen + MIN_GAP, rounded up to the next multiple of 4.
 *   - If no line in the group has code (pure continuation block), commentCol = 0
 *     and comments start at the beginning of the line.
 *
 * CONTINUATION LINES:
 *   - A line whose code part is empty (only whitespace before the sentinel) is
 *     a continuation line. It is padded to the same commentCol as the group.
 */
function alignCommentGroups(lines) {
    const MIN_GAP = 1; // minimum spaces between end of code and start of comment

    const result = [...lines];
    let i = 0;

    while (i < result.length) {
        // Only lines with a sentinel start or continue a group.
        if (!result[i].includes('\x00')) {
            i++;
            continue;
        }

        // Collect a contiguous run of sentinel-carrying lines.
        // Any line without a sentinel (blank or code-only) ends the group.
        const groupStart = i;
        while (i < result.length && result[i].includes('\x00')) {
            i++;
        }
        const groupEnd = i; // exclusive

        // Measure the longest code part in this group.
        let maxCodeLen = 0;
        let hasCodeLines = false;
        for (let j = groupStart; j < groupEnd; j++) {
            const sentinelIdx = result[j].indexOf('\x00');
            const codePart = result[j].slice(0, sentinelIdx);
            if (codePart.trim().length > 0) {
                hasCodeLines = true;
                const len = visualLength(codePart);
                if (len > maxCodeLen) maxCodeLen = len;
            }
        }

        // Determine the comment column for this group.
        let commentCol;
        if (!hasCodeLines) {
            // Pure comment-continuation block — flush left.
            commentCol = 0;
        } else {
            commentCol = maxCodeLen + MIN_GAP;
            // Round up to the next multiple of 4 for clean alignment.
            commentCol = Math.ceil(commentCol / 4) * 4;
        }

        // Rewrite every line in the group.
        for (let j = groupStart; j < groupEnd; j++) {
            const sentinelIdx = result[j].indexOf('\x00');
            const codePart    = result[j].slice(0, sentinelIdx);
            const comment     = result[j].slice(sentinelIdx + 1);
            const codeLen     = visualLength(codePart);

            let padding;
            if (codePart.trim().length === 0) {
                // Continuation line: pad from column 0 to commentCol.
                padding = ' '.repeat(commentCol);
            } else {
                const spaces = commentCol - codeLen;
                padding = ' '.repeat(spaces > 0 ? spaces : MIN_GAP);
            }

            result[j] = (codePart + padding + comment).trimEnd();
        }
    }

    return result;
}

function deactivate() { }

function activate(context) {
    const supportedLanguages = [
        { language: 'assembly' }, 
        { language: 'asm' }, 
        { language: 'asm-intel-x86-generic' },
        { language: 'x86' },
        { language: 'x86_64' },
        { language: 'nasm' },
        { language: 'masm' },
        { language: 'fasm' }
    ];

    const provider = vscode.languages.registerDocumentFormattingEditProvider(supportedLanguages, {
        provideDocumentFormattingEdits(document, options, token) {

            // Pass 1: format each line individually (comments marked with \x00 sentinel)
            const formattedLines = [];
            for (let i = 0; i < document.lineCount; i++) {
                if (token.isCancellationRequested) return [];
                const line = document.lineAt(i);
                try {
                    formattedLines.push(formatAsmLine(line.text));
                } catch (e) {
                    console.error(`asm-formatter: line ${i + 1}:`, e);
                    formattedLines.push(line.text);
                }
            }

            // Pass 2: align comment groups across consecutive commented lines
            const alignedLines = alignCommentGroups(formattedLines);

            // Build edits
            const edits = [];
            for (let i = 0; i < document.lineCount; i++) {
                const original = document.lineAt(i).text;
                const formatted = alignedLines[i];
                if (original !== formatted) {
                    edits.push(vscode.TextEdit.replace(document.lineAt(i).range, formatted));
                }
            }
            return edits;
        }
    });

    context.subscriptions.push(provider);
}

module.exports = {
    activate,
    deactivate
};