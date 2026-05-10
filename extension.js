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

    if (!codePart) return comment; // Line was entirely a comment

    // 2. Tokenize the code part respecting strings
    const tokenRegex = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
    const tokens = codePart.match(tokenRegex) || [];

    let label = '';
    let instruction = '';
    let operands = '';
    let tokenIdx = 0;

    // Directives to help us infer if a word is a label or a top-level declaration
    const dataDirectives = /^(db|dw|dd|dq|dt|resb|resw|resd|resq|rb|rw|rd|rq|equ)$/i;
    const rootDirectives = /^(section|segment|format|include|global|extern)$/i;

    // 3. Identify Label
    if (tokens[tokenIdx].endsWith(':')) {
        // Standard code label with colon
        label = tokens[tokenIdx];
        tokenIdx++;
    } else if (tokens.length > 1 && dataDirectives.test(tokens[1])) {
        // Variable label without colon (e.g., "filename db ...")
        label = tokens[0];
        tokenIdx++;
    }

    // 4. Identify Instruction
    if (tokenIdx < tokens.length) {
        instruction = tokens[tokenIdx].toLowerCase();
        tokenIdx++;
    }

    // 5. Identify and format Operands
    if (tokenIdx < tokens.length) {
        // Grab exactly what's left after the instruction to preserve internal string formatting
        let instrWord = tokens[tokenIdx - 1];
        let instrPos = codePart.indexOf(instrWord);
        let operandsStart = instrPos + instrWord.length;
        let rawOperands = codePart.substring(operandsStart).trim();

        // Safe operand comma formatting: add spaces after commas, but NOT inside quotes
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

    // 6. Output Construction
    let formattedLine = '';

    if (label) {
        // Bumped label padding to 16 to accommodate typical variable names
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
            const commentColumn = 48; // Adjusted column width for wider data sections
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

module.exports = {
    activate,
    deactivate
};