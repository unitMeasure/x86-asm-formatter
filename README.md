# x86 Intel ASM Formatter

A lightweight, strict formatter for x86 Intel assembly code in Visual Studio Code. It normalizes indentation, aligns inline comments, and enforces consistent casing for instructions.

## Features

*   **Tab Normalization:** Enforces strict tab boundaries to prevent invisible spacing issues.
*   **Comment Alignment:** Pushes inline comments (`;`) to a uniform column for readability.
*   **Instruction Casing:** Automatically converts instructions (e.g., `SHL`, `EAX`) to consistent formats.
*   **Multi-Syntax Support:** Works out of the box with standard `.asm` files and `asm-intel-x86-generic` highlighters.

## Usage

1. Open any `.asm`, `.s`, or `.inc` file.
2. Right-click and select **Format Document**, or use the keyboard shortcut `Shift + Alt + F`.


## Installation

Install the extension from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=unitMeasure.x86-asm-formatter) 