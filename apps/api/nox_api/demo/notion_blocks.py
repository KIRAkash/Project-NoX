"""Markdown to Notion blocks, for seeding demo pages."""

import re


def parse_notion_rich_text(text: str):
    if not text:
        return []
    # Tokenize bold (**...**), code (`...`), and normal text
    tokens = []
    pattern = re.compile(r'(\*\*.*?\*\*|`.*?`|[^\*`]+)')
    for match in pattern.finditer(text):
        chunk = match.group(0)
        if chunk.startswith('**') and chunk.endswith('**') and len(chunk) >= 4:
            tokens.append({
                "type": "text",
                "text": {"content": chunk[2:-2]},
                "annotations": {"bold": True}
            })
        elif chunk.startswith('`') and chunk.endswith('`') and len(chunk) >= 2:
            tokens.append({
                "type": "text",
                "text": {"content": chunk[1:-1]},
                "annotations": {"code": True}
            })
        else:
            tokens.append({
                "type": "text",
                "text": {"content": chunk}
            })
    return tokens or [{"type": "text", "text": {"content": text}}]

def markdown_to_notion_blocks(md_text: str):
    """Convert Markdown string to Notion native block objects."""
    blocks = []
    lines = md_text.strip().split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        # Check divider
        if line in ('---', '***', '___'):
            blocks.append({
                "object": "block",
                "type": "divider",
                "divider": {}
            })
            i += 1
            continue

        # Check Headings
        if line.startswith('### '):
            blocks.append({
                "object": "block",
                "type": "heading_3",
                "heading_3": {"rich_text": parse_notion_rich_text(line[4:].strip())}
            })
            i += 1
            continue
        elif line.startswith('## '):
            blocks.append({
                "object": "block",
                "type": "heading_2",
                "heading_2": {"rich_text": parse_notion_rich_text(line[3:].strip())}
            })
            i += 1
            continue
        elif line.startswith('# '):
            blocks.append({
                "object": "block",
                "type": "heading_1",
                "heading_1": {"rich_text": parse_notion_rich_text(line[2:].strip())}
            })
            i += 1
            continue

        # Check Bullet Lists
        if line.startswith(('- ', '* ')):
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": parse_notion_rich_text(line[2:].strip())}
            })
            i += 1
            continue

        # Check Numbered List
        num_match = re.match(r'^\d+\.\s+(.*)', line)
        if num_match:
            blocks.append({
                "object": "block",
                "type": "numbered_list_item",
                "numbered_list_item": {"rich_text": parse_notion_rich_text(num_match.group(1).strip())}
            })
            i += 1
            continue

        # Check Table
        if line.startswith('|') and line.endswith('|'):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith('|') and lines[i].strip().endswith('|'):
                tline = lines[i].strip()
                # Skip separator lines like |---|---|
                if not re.match(r'^\|(\s*[-:]+\s*\|)+$', tline):
                    table_lines.append(tline)
                i += 1

            if table_lines:
                rows_data = []
                for tl in table_lines:
                    cols = [c.strip() for c in tl.strip('|').split('|')]
                    rows_data.append(cols)

                max_cols = max(len(r) for r in rows_data) if rows_data else 1
                table_rows_blocks = []
                for r in rows_data:
                    padded_r = r + [''] * (max_cols - len(r))
                    row_cells = [parse_notion_rich_text(cell) for cell in padded_r]
                    table_rows_blocks.append({
                        "type": "table_row",
                        "table_row": {"cells": row_cells}
                    })

                blocks.append({
                    "object": "block",
                    "type": "table",
                    "table": {
                        "table_width": max_cols,
                        "has_column_header": True,
                        "has_row_header": False,
                        "children": table_rows_blocks
                    }
                })
            continue

        # Default: paragraph block
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": parse_notion_rich_text(line)}
        })
        i += 1

    return blocks

