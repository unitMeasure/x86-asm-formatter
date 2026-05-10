const vscode = require('vscode');

function formatAsmLine(line) {
    let text = line.trim();
    if (!text) return '';

    // Capture the exact leading whitespace the user typed
    const leadingWhitespaceMatch = line.match(/^[ \t]*/);
    const originalIndent = leadingWhitespaceMatch ? leadingWhitespaceMatch[0] : '';

    // Pass through full-line comments while preserving their original indentation
    if (text.startsWith(';')) {
        return originalIndent + text;
    }

    let comment = '';
    let codePart = text;
    let inString = false;
    let stringChar = '';
    
    // 1. Safely extract comment (ignoring ';' inside strings)
    for (let i = 0; i < text.length; i++) {
        let char = text[i];
        if ((char === "'" || char === '"') && (i === 0 || text[i-1] !== '\\')) {
            if (!inString) {
                inString = true;
                stringChar = char;
            } else if (stringChar === char) {
                inString = false;
            }
        }
        if (char === ';' && !inString) {
            comment = text.slice(i).trim();
            codePart = text.slice(0, i).trim();
            break;
        }
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
        
        // Only format the comment alignment
        if (comment) {
            const currentLength = formattedLine.replace(/\t/g, '    ').length;
            const commentColumn = 48;
            let paddingSpaces = commentColumn - currentLength;
            if (paddingSpaces <= 0) paddingSpaces = 4;
            const tabsCount = Math.ceil(paddingSpaces / 4);
            formattedLine += '\t'.repeat(tabsCount > 0 ? tabsCount : 1) + comment;
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
            if ((char === "'" || char === '"') && (i === 0 || rawOperands[i-1] !== '\\')) {
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
        // FIX: Guarantee at least one space if the label overflows the 16-character column
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

    // Standard Comment Alignment
    if (comment) {
        if (formattedLine.length > 0) {
            const currentLength = formattedLine.replace(/\t/g, '    ').length;
            const commentColumn = 48;
            let paddingSpaces = commentColumn - currentLength;
            if (paddingSpaces <= 0) paddingSpaces = 4;
            const tabsCount = Math.ceil(paddingSpaces / 4);
            formattedLine += '\t'.repeat(tabsCount > 0 ? tabsCount : 1) + comment;
        } else {
            formattedLine = comment;
        }
    }

    return formattedLine.trimEnd();
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
            const edits = [];
            for (let i = 0; i < document.lineCount; i++) {
                if (token.isCancellationRequested) return [];
                const line = document.lineAt(i);
                try {
                    const formattedText = formatAsmLine(line.text);
                    if (line.text !== formattedText) {
                        edits.push(vscode.TextEdit.replace(line.range, formattedText));
                    }
                } catch (e) {
                    console.error(`asm-formatter: line ${i + 1}:`, e);
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