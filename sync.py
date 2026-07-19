#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync.py — Bộ sinh file luật cho agent.

Đọc PROJECT.md (nguồn sự thật DUY NHẤT) và sinh ra:
  - CLAUDE.md : cảnh báo AUTO-GENERATED + header riêng cho Claude Code + nội dung PROJECT.md
  - AGENTS.md : cảnh báo AUTO-GENERATED + header riêng cho Codex CLI + nội dung PROJECT.md

Ngoài ra: mirror thư mục `.claude/skills/` sang `.agents/skills/` để giữ parity
(xóa skill thừa ở đích). Nếu không có `.claude/skills/` thì in cảnh báo và bỏ qua,
KHÔNG báo lỗi.

Chỉ dùng thư viện chuẩn: os, sys, shutil, datetime.
Cách dùng:  python sync.py
"""

import os
import sys
import shutil
from datetime import datetime

# Bảo đảm log tiếng Việt in được trên console Windows (cp1252) -> ép UTF-8.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    # Python < 3.7 hoặc stream không hỗ trợ reconfigure -> bỏ qua, không lỗi.
    pass

# ---------------------------------------------------------------------------
# Đường dẫn cơ sở = thư mục chứa sync.py (gốc repo)
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_MD = os.path.join(ROOT, "PROJECT.md")
CLAUDE_MD = os.path.join(ROOT, "CLAUDE.md")
AGENTS_MD = os.path.join(ROOT, "AGENTS.md")
CLAUDE_SKILLS = os.path.join(ROOT, ".claude", "skills")
AGENTS_SKILLS = os.path.join(ROOT, ".agents", "skills")

# ---------------------------------------------------------------------------
# Cảnh báo AUTO-GENERATED (đứng đầu mọi file sinh ra)
# ---------------------------------------------------------------------------
AUTOGEN_WARNING = (
    "<!--\n"
    "============================================================\n"
    "  THIS FILE IS AUTO-GENERATED\n"
    "  DO NOT EDIT\n"
    "  Edit PROJECT.md then run: python sync.py\n"
    "============================================================\n"
    "-->\n"
)


def claude_header(now):
    """Header riêng cho Claude Code."""
    return (
        "# CLAUDE.md — Hướng dẫn cho Claude Code\n\n"
        "> **File này được sinh tự động** từ `PROJECT.md` bởi `sync.py` "
        f"(lần sinh: {now}). **Không sửa tay** — hãy sửa `PROJECT.md` rồi chạy `python sync.py`.\n\n"
        "- **Nguồn sự thật:** `PROJECT.md` là nguồn luật DUY NHẤT của dự án.\n"
        "- **Skills:** đặt ở `.claude/skills/`.\n"
        "- **Spec Kit:** CHỈ dùng cho feature lớn / đổi API-schema / major UI flow; "
        "KHÔNG dùng cho hotfix nhỏ.\n"
        "- **Đầu mỗi session:** đọc `.claude/handoff.md` để nắm bối cảnh bàn giao.\n"
        "- **Kiểm tra môi trường:** xin duyệt trước khi `npm install` / global installer / "
        "sửa `.env`; KHÔNG đọc/sửa `.env`, `node_modules/`, `dist/`.\n\n"
        "---\n\n"
    )


def codex_header(now):
    """Header riêng cho Codex CLI."""
    return (
        "# AGENTS.md — Hướng dẫn cho Codex CLI\n\n"
        "> **File này được sinh tự động** từ `PROJECT.md` bởi `sync.py` "
        f"(lần sinh: {now}). **Không sửa tay** — hãy sửa `PROJECT.md` rồi chạy `python sync.py`.\n\n"
        "- **Nguồn sự thật:** `PROJECT.md` là nguồn luật DUY NHẤT của dự án.\n"
        "- **Skills:** đặt ở `.agents/skills/`.\n"
        "- **Spec Kit:** CHỈ dùng cho feature lớn / đổi API-schema / major UI flow; "
        "KHÔNG dùng cho hotfix nhỏ.\n"
        "- **Đầu mỗi session:** đọc `.claude/handoff.md` để nắm bối cảnh bàn giao.\n"
        "- **Kiểm tra môi trường:** xin duyệt trước khi `npm install` / global installer / "
        "sửa `.env`; KHÔNG đọc/sửa `.env`, `node_modules/`, `dist/`.\n\n"
        "---\n\n"
    )


def read_project_md():
    """Đọc nội dung PROJECT.md (UTF-8). Thoát nếu không tồn tại."""
    if not os.path.isfile(PROJECT_MD):
        print("❌ Lỗi: không tìm thấy PROJECT.md. Không thể sinh file.")
        sys.exit(1)
    with open(PROJECT_MD, "r", encoding="utf-8") as f:
        return f.read()


def write_file(path, content):
    """Ghi file UTF-8."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def generate_agent_files(project_content, now):
    """Sinh CLAUDE.md và AGENTS.md từ nội dung PROJECT.md."""
    claude_content = AUTOGEN_WARNING + "\n" + claude_header(now) + project_content
    agents_content = AUTOGEN_WARNING + "\n" + codex_header(now) + project_content

    write_file(CLAUDE_MD, claude_content)
    print("✅ Đã sinh: CLAUDE.md  (header Claude Code + nội dung PROJECT.md)")

    write_file(AGENTS_MD, agents_content)
    print("✅ Đã sinh: AGENTS.md  (header Codex CLI + nội dung PROJECT.md)")


def mirror_skills():
    """
    Mirror .claude/skills/ -> .agents/skills/ (giữ parity: xóa skill thừa ở đích).
    Nếu không có .claude/skills/ thì cảnh báo và bỏ qua, KHÔNG lỗi.
    """
    if not os.path.isdir(CLAUDE_SKILLS):
        print("⚠️  Bỏ qua mirror skills: không tìm thấy '.claude/skills/'.")
        return

    # Xóa đích cũ để bảo đảm parity tuyệt đối (không còn skill thừa)
    if os.path.isdir(AGENTS_SKILLS):
        shutil.rmtree(AGENTS_SKILLS)

    # Bảo đảm thư mục cha '.agents/' tồn tại rồi copy toàn bộ cây skills
    os.makedirs(os.path.dirname(AGENTS_SKILLS), exist_ok=True)
    shutil.copytree(CLAUDE_SKILLS, AGENTS_SKILLS)

    count = len(
        [d for d in os.listdir(AGENTS_SKILLS) if os.path.isdir(os.path.join(AGENTS_SKILLS, d))]
    )
    print(f"✅ Đã mirror skills: '.claude/skills/' -> '.agents/skills/' ({count} skill).")


def main():
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("=" * 60)
    print("sync.py — sinh file luật từ PROJECT.md")
    print("=" * 60)

    project_content = read_project_md()
    generate_agent_files(project_content, now)
    mirror_skills()

    print("=" * 60)
    print("🎉 Hoàn tất đồng bộ.")
    print("=" * 60)


if __name__ == "__main__":
    main()
