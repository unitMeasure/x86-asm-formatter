const vscode = require('vscode');

function formatAsmLine(line) {
    let text = line.trim();
    if (!text) return '';

    // Pass through full-line comments seamlessly
    if (text.startsWith(';')) {
        return text;
    }

    // 1. Safely extract comment (ignoring ';' inside strings)
    let comment = '';
    let codePart = text;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < text.length; i++) {
        let char = text[i];
        if ((char === "'" || char === '"') && (i === 0 || text[i - 1] !== '\\')) {
            if (!inString) { inString = true; stringChar = char; }
            else if (stringChar === char) { inString = false; }
        }
        if (char === ';' && !inString) {
            comment = text.slice(i).trim();
            codePart = text.slice(0, i).trim();
            break;
        }
    }

    if (!codePart) return comment;

    // 2. Tokenize the code part, tracking each token's START POSITION in codePart.
    //    This is the key fix: instead of re-searching for token positions later
    //    (which fails when a label contains the instruction as a substring),
    //    we record the index where each token begins as we scan.
    const tokens = [];      // { text: string, start: number }
    let i = 0;
    while (i < codePart.length) {
        // Skip whitespace
        while (i < codePart.length && /\s/.test(codePart[i])) i++;
        if (i >= codePart.length) break;

        const tokenStart = i;
        let tokenText = '';
        let inQ = false, qCh = '';

        while (i < codePart.length) {
            const c = codePart[i];
            if ((c === "'" || c === '"') && (i === 0 || codePart[i - 1] !== '\\')) {
                if (!inQ) { inQ = true; qCh = c; }
                else if (qCh === c) { inQ = false; }
            }
            if (!inQ && /\s/.test(c)) break;
            tokenText += c;
            i++;
        }
        tokens.push({ text: tokenText, start: tokenStart });
    }

    if (tokens.length === 0) return comment;

    const dataDirectives = /^(db|dw|dd|dq|dt|resb|resw|resd|resq|rb|rw|rd|rq|equ)$/i;
    const rootDirectives = /^(section|segment|format|include|global|extern)$/i;

    let label = '';
    let instruction = '';
    let operands = '';
    let tokenIdx = 0;

    // 3. Identify Label
    if (tokens[tokenIdx].text.endsWith(':')) {
        label = tokens[tokenIdx].text;
        tokenIdx++;
    } else if (tokens.length > 1 && dataDirectives.test(tokens[1].text)) {
        // Variable label without colon (e.g., "filename db ...")
        label = tokens[tokenIdx].text;
        tokenIdx++;
    }

    // 4. Identify Instruction
    let instrEndPos = 0;
    if (tokenIdx < tokens.length) {
        instruction = tokens[tokenIdx].text.toLowerCase();
        // instrEndPos is where the instruction token ends in codePart
        instrEndPos = tokens[tokenIdx].start + tokens[tokenIdx].text.length;
        tokenIdx++;
    }

    // 5. Identify Operands — use the tracked position, NOT indexOf
    if (tokenIdx < tokens.length) {
        // Everything after the instruction token (skipping whitespace) is the raw operands
        let rawOperands = codePart.substring(instrEndPos).trim();

        // Safe operand comma formatting: add spaces after commas, but NOT inside quotes
        let formattedOperands = '';
        let inQuotes = false;
        let quoteCh = '';
        let currentOp = '';

        for (let j = 0; j < rawOperands.length; j++) {
            const char = rawOperands[j];
            if ((char === "'" || char === '"') && (j === 0 || rawOperands[j - 1] !== '\\')) {
                if (!inQuotes) { inQuotes = true; quoteCh = char; }
                else if (quoteCh === char) { inQuotes = false; }
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

    // 6. Output Construction
    let formattedLine = '';

    if (label) {
        formattedLine += label.padEnd(16, ' ');
    } else if (instruction && rootDirectives.test(instruction)) {
        // Root directives like 'section' look best unindented
    } else {
        formattedLine += '\t';
    }

    if (instruction) {
        formattedLine += instruction.padEnd(8, ' ');
        if (operands) {
            formattedLine += operands;
        }
    }

    // 7. Align Comments
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