import { describe, expect, test } from "vitest";
import { readBuilt } from "../helpers/build-site";

describe("activity pages", () => {
  test("combines the latest daily briefing with the filterable activity index", async () => {
    const html = await readBuilt("activity/index.html");

    expect(html).toContain("GLM 开源动态");
    expect(html).not.toContain("Issue / PR 动态库");
    expect(html).toContain("2026-08-20 日报");
    expect(html).toContain("这是首版本地样例日报");
    expect(html).toContain('class="daily-change-list"');
    expect(html).toContain('class="daily-scroll-region"');
    expect(html).toMatch(/\.daily-scroll-region[^\{]*\{[^}]*height:\s*20rem[^}]*overflow-y:\s*auto/s);
    expect(html).toContain('class="daily-type-group"');
    expect(html).toContain(">Issue</h3>");
    expect(html).toContain(">PR</h3>");
    expect(html).toMatch(/data-framework-tag="hiyouga\/LlamaFactory"[^>]*>.*LLaMA-Factory/s);
    expect(html).toMatch(/data-framework-tag="vllm-project\/vllm"[^>]*>.*vLLM/s);
    expect(html).toMatch(/class="daily-item-badges"[^>]*>.*data-framework-tag="vllm-project\/vllm".*class="badge/s);
    expect(html).toContain("样例：修复 GLM 推理输出一致性");
    expect(html).toContain("修复 GLM 推理输出一致性问题");
    expect(html).toContain('class="card-summary"');
    expect(html).toMatch(/\.daily-item-summary[^\{]*\{[^}]*-webkit-line-clamp:\s*2/s);
    expect(html).toContain('class="daily-item-summary"');
    expect(html).toContain("PR #10004");
    expect(html).toContain("已合并");
    expect(html).not.toContain('href="/reports/2026-08-20/"');
    expect(html).toContain('href="/reports/"');
    expect(html).toContain("查看往期日报");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("vllm-project/vllm");
    expect(html).toContain("请先选择类型");
    expect(html).toMatch(/<select name="model"[^>]*>/);
    expect(html).toContain("全部模型");
    expect(html).toContain("GLM（未指定版本）");
    expect(html).toContain('data-activity-pagination');
    expect(html).toContain('aria-label="跳转页码"');
    expect(html).toContain('data-page-options');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("上一页");
    expect(html).toContain("下一页");
    expect(html).toContain("支持诉求");
    expect(html).toContain("Bug 修复");
    expect(html).toContain("重置筛选");
    expect(html).toContain("原始链接 ↗");
    expect(html).not.toContain("上游 ↗");
    expect(html).toMatch(/class="card-footer"[^>]*>.*?<span[^>]*>PR #10004<\/span>.*?<span[^>]*>Bug 修复<\/span>/s);
    expect(html).not.toMatch(/class="card-footer"[^>]*>.*?<span[^>]*>FIX<\/span>/s);
    expect(html).not.toContain("待分类");
    expect(html).toContain("2026年8月20日 17:20");
  });

  test("uses one unified activity entry in the primary navigation", async () => {
    const html = await readBuilt("activity/index.html");

    expect(html).toMatch(/<a href="\/activity\/"[^>]*aria-current="page"[^>]*>开源动态<\/a>/);
    expect(html).not.toMatch(/<a href="\/reports\/"[^>]*>日报<\/a>/);
    expect(html).not.toContain("能力矩阵");
    expect(html).not.toContain('href="/capabilities/"');
  });

  test("publishes one traceable static page per item", async () => {
    const html = await readBuilt(
      "activity/vllm-project-vllm/pr/10004/index.html",
    );

    expect(html).toContain("推理输出一致性修复已合并");
    expect(html).toContain("GLM 相关性依据");
    expect(html).toContain("查看原始链接");
    expect(html).toContain("返回开源动态");
    expect(html).toContain('rel="noreferrer"');
  });
});
