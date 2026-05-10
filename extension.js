const vscode = require('vscode');

function formatAsmLine(line) {
    let text = line.trim();
    if (!text) return '';

    // Pass through full-line comments seamlessly
    if (text.startsWith(';')) {
        return text;
    }

    // Regex to extract label, instruction, operands, and inline comment
    const asmRegex = /^(?:([A-Za-z0-9_@.]+):)?\s*(?:([A-Za-z0-9]+)\s+([^;]+)?)?(?:(;.*))?$/;
    const match = text.match(asmRegex);

    if (!match) return text; // Return original if it doesn't match standard asm pattern

    const label = match[1] ? match[1] + ':' : '';
    // Normalize instructions to lowercase for consistent x86 styling
    const instruction = match[2] ? match[2].toLowerCase() : ''; 
    let operands = match[3] ? match[3].trim() : '';
    const comment = match[4] ? match[4].trim() : '';

    // Normalize operand spacing (e.g., "eax,ebx" becomes "eax, ebx")
    if (operands) {
        operands = operands.split(',').map(op => op.trim()).join(', ');
    }

    let formattedLine = '';

    // Enforce strict tab boundaries to avoid indentation parsing issues
    if (label) {
        // Put label on its own line if it's followed by an instruction, 
        // or keep it standard depending on your preferred x86 style.
        // Here, we'll keep the instruction on the same line, padded.
        formattedLine += label.padEnd(12, ' ');
    } else {
        formattedLine += '\t';
    }

    if (instruction) {
        formattedLine += instruction.padEnd(8, ' ');
        if (operands) {
            formattedLine += operands;
        }
    }

    // Align comments to a standard column 
    if (comment) {
        const currentLength = formattedLine.replace(/\t/g, '    ').length;
        const commentColumn = 40;
        let paddingSpaces = commentColumn - currentLength;
        
        if (paddingSpaces <= 0) paddingSpaces = 4;
        
        // Use tabs to bridge the gap to the comment block
        const tabsCount = Math.ceil(paddingSpaces / 4);
        formattedLine += '\t'.repeat(tabsCount > 0 ? tabsCount : 1) + comment;
    }

    // Clean up empty lines that might just consist of a single tab
    return formattedLine.trim() === '' ? '' : formattedLine;
}

function activate(context) {
    let provider = vscode.languages.registerDocumentFormattingEditProvider(
        [{ language: 'assembly' }, { language: 'asm' }, { language: 'asm-intel-x86-generic' }], {
        provideDocumentFormattingEdits(document, options, token) {
            const edits = [];
            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                const formattedText = formatAsmLine(line.text);
                
                // Only create an edit if the line actually needs formatting
                if (line.text !== formattedText) {
                    edits.push(vscode.TextEdit.replace(line.range, formattedText));
                }
            }
            return edits;
        }
    });

    context.subscriptions.push(provider);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};