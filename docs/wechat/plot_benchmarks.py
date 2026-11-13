#!/usr/bin/env python3
"""Benchmark figures for the WeChat article, drawn in an ICLR paper style.

Reads the tables in docs/experiments/ and writes each figure as PDF (for papers)
and PNG (for the article) into docs/wechat/figures/:

  mle_bench_summary           gold-medal rate and mean rank of every method
  mle_bench_per_task          every method's score against the human gold-medal threshold
  frontier_science_progress   composite and per-track scores over the submissions

Usage:  python docs/wechat/plot_benchmarks.py [--data DIR] [--out DIR]
Needs:  matplotlib, numpy
"""

from __future__ import annotations

import argparse
import math
import re
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib import font_manager, ticker  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

# One accent for our method, neutral grey for prior work, gold for the human threshold.
# The pairs were checked for colour-blind separation.
OURS = "#1F5AA6"
OURS_SOFT = "#AFC6E6"
PRIOR = "#9C9C9C"
PRIOR_BAR = "#C8C8C8"
GOLD = "#B8860B"
GOLD_ZONE = "#F6E9C3"
RESEARCH = "#C2571A"
INK = "#1A1A1A"
MUTED = "#6B6B6B"
GUIDE = "#E6E6E6"

TEXT_WIDTH = 5.5  # ICLR \textwidth in inches

TASK_LABELS = {
    "aerial-cactus": "Aerial Cactus",
    "spooky-author": "Spooky Author",
    "denoising-dirty-docs": "Denoising Docs",
    "dogs-vs-cats-redux": "Dogs vs. Cats",
    "histopathologic-cancer": "Histopathology",
    "leaf-classification": "Leaf Classification",
    "nyc-taxi-fare": "NYC Taxi Fare",
    "plant-pathology-2020": "Plant Pathology",
    "nomad2018": "NOMAD 2018",
}
METRIC_LABELS = {"Acc": "Accuracy"}


TIMES_LIKE = (
    "Times New Roman",
    "Times",
    "STIX Two Text",
    "Liberation Serif",
    "TeX Gyre Termes",
    "Nimbus Roman",
)


def pick_serif() -> str:
    """A Times-like face, as in the ICLR template, preferring TrueType files.

    PDFs embed fonts as TrueType (pdf.fonttype 42); OpenType files with CFF outlines
    embed badly that way, so when a family ships both, its CFF files are set aside.
    """
    manager = font_manager.fontManager

    def truetype(entry: font_manager.FontEntry) -> bool:
        return entry.fname.lower().endswith((".ttf", ".ttc"))

    for name in TIMES_LIKE:
        if any(entry.name == name and truetype(entry) for entry in manager.ttflist):
            manager.ttflist = [e for e in manager.ttflist if e.name != name or truetype(e)]
            return name
    installed = {entry.name for entry in manager.ttflist}
    return next((name for name in TIMES_LIKE if name in installed), "DejaVu Serif")


def use_paper_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "serif",
            "font.serif": [pick_serif(), "DejaVu Serif"],
            "mathtext.fontset": "stix",
            "font.size": 8.5,
            "axes.titlesize": 8.5,
            "axes.labelsize": 8.5,
            "xtick.labelsize": 7.5,
            "ytick.labelsize": 8,
            "legend.fontsize": 7.5,
            "text.color": INK,
            "axes.labelcolor": INK,
            "axes.edgecolor": "#444444",
            "axes.linewidth": 0.6,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "xtick.color": "#444444",
            "ytick.color": "#444444",
            "xtick.major.width": 0.6,
            "ytick.major.width": 0.6,
            "xtick.major.size": 2.5,
            "ytick.major.size": 2.5,
            "grid.color": GUIDE,
            "grid.linewidth": 0.6,
            "legend.frameon": False,
            "legend.handletextpad": 0.5,
            "pdf.fonttype": 42,
            "ps.fonttype": 42,
            "savefig.dpi": 400,
            "savefig.bbox": "tight",
            "savefig.pad_inches": 0.03,
        }
    )


def save(fig: plt.Figure, out: Path, name: str) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for suffix in ("pdf", "png"):
        fig.savefig(out / f"{name}.{suffix}", facecolor="white")
    plt.close(fig)
    print(f"wrote {out / name}.pdf and .png")


# --------------------------------------------------------------------------- MLE-bench


@dataclass
class Task:
    key: str
    metric: str
    higher_better: bool
    gold: float
    prior: dict[str, tuple[float, int, int] | None]  # mean score, runs at gold, runs
    ours: float

    def at_gold(self, value: float) -> bool:
        return value >= self.gold if self.higher_better else value <= self.gold

    def scores(self) -> dict[str, float]:
        found = {name: cell[0] for name, cell in self.prior.items() if cell}
        return {"Ours": self.ours, **found}


def read_mle(path: Path) -> tuple[list[str], list[Task]]:
    def cells(line: str) -> list[str]:
        return [cell.strip() for cell in line.strip().strip("|").split("|")]

    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.startswith("|")]
    header = cells(lines[0])
    if header[-1] != "Ours":
        raise SystemExit(f"{path}: the last column must be Ours")
    methods = header[2:-2]  # between the gold threshold and "best single run of all methods"
    tasks = []
    for line in lines[1:]:
        row = cells(line)
        if set(row[0]) <= {"-", ":"}:
            continue
        name = re.fullmatch(r"(.+?)（(.+?)([↑↓])）", row[0])
        if not name:
            raise SystemExit(f"{path}: cannot read the task cell {row[0]!r}")
        prior: dict[str, tuple[float, int, int] | None] = {}
        for method, cell in zip(methods, row[2:-2]):
            value = re.fullmatch(r"([\d.]+)\s*\((\d+)/(\d+)\)", cell)
            prior[method] = (
                (float(value.group(1)), int(value.group(2)), int(value.group(3))) if value else None
            )
        tasks.append(
            Task(
                key=name.group(1),
                metric=name.group(2),
                higher_better=name.group(3) == "↑",
                gold=float(row[1]),
                prior=prior,
                ours=float(row[-1]),
            )
        )
    return methods, tasks


def gold_rate(tasks: list[Task], method: str) -> tuple[float, int]:
    """Mean share of runs at gold over the tasks the method reports, and how many it reports."""
    if method == "Ours":  # one run per task
        return 100 * sum(task.at_gold(task.ours) for task in tasks) / len(tasks), len(tasks)
    shares = [cell[1] / cell[2] for task in tasks if (cell := task.prior[method])]
    return 100 * sum(shares) / len(shares), len(shares)


def mean_ranks(tasks: list[Task]) -> dict[str, float]:
    """Mean per-task rank (1 = best, ties share the mean rank) over the tasks a method reports."""
    ranks: dict[str, list[float]] = {}
    for task in tasks:
        scores = task.scores()
        ordered = sorted(scores.items(), key=lambda kv: -kv[1] if task.higher_better else kv[1])
        start = 0
        while start < len(ordered):
            end = start
            while end + 1 < len(ordered) and ordered[end + 1][1] == ordered[start][1]:
                end += 1
            for name, _ in ordered[start : end + 1]:
                ranks.setdefault(name, []).append((start + end) / 2 + 1)
            start = end + 1
    return {name: sum(values) / len(values) for name, values in ranks.items()}


def method_order(methods: list[str], tasks: list[Task]) -> list[str]:
    """Ours first, then prior methods by gold-medal rate."""
    return ["Ours"] + sorted(methods, key=lambda method: -gold_rate(tasks, method)[0])


def display_name(method: str, tasks: list[Task]) -> str:
    return method + ("$^\\dagger$" if gold_rate(tasks, method)[1] < len(tasks) else "")


def plot_mle_summary(methods: list[str], tasks: list[Task], out: Path) -> None:
    order = method_order(methods, tasks)
    rates = {method: gold_rate(tasks, method)[0] for method in order}
    ranks = mean_ranks(tasks)
    y = np.arange(len(order))[::-1]

    fig, (left, right) = plt.subplots(
        1,
        2,
        figsize=(TEXT_WIDTH, 2.15),
        sharey=True,
        gridspec_kw={"width_ratios": [1.12, 1], "wspace": 0.1},
    )

    left.barh(
        y,
        [rates[m] for m in order],
        height=0.64,
        color=[OURS if m == "Ours" else PRIOR_BAR for m in order],
        zorder=2,
    )
    for row, method in zip(y, order):
        left.text(
            rates[method] + 1.2,
            row,
            f"{rates[method]:.1f}",
            va="center",
            fontsize=7.5,
            fontweight="bold" if method == "Ours" else "normal",
        )
    left.set_xlim(0, 75)
    left.set_xlabel(r"Gold-medal rate (%) $\uparrow$")
    left.set_title("(a) Tasks at human gold-medal level", loc="left")
    left.xaxis.grid(True, zorder=0)
    left.set_axisbelow(True)
    left.set_yticks(y, [display_name(m, tasks) for m in order])
    left.tick_params(axis="y", length=0)
    for label in left.get_yticklabels():
        if label.get_text() == "Ours":
            label.set_fontweight("bold")

    count = len(order)
    for row, method in zip(y, order):
        ours = method == "Ours"
        right.hlines(row, 1, count, color=GUIDE, lw=0.6, zorder=0)
        right.plot(
            ranks[method],
            row,
            "o",
            ms=6.5 if ours else 5,
            color=OURS if ours else PRIOR,
            mec="white",
            mew=0.8,
            zorder=3,
        )
        right.text(
            ranks[method] + 0.28,
            row,
            f"{ranks[method]:.2f}",
            va="center",
            fontsize=7.5,
            fontweight="bold" if ours else "normal",
        )
    right.set_xlim(0.6, count + 0.6)
    right.set_xticks(range(1, count + 1))
    right.set_xlabel(r"Mean rank over tasks $\downarrow$")
    right.set_title("(b) Rank among methods", loc="left")
    right.tick_params(axis="y", length=0)
    right.spines["left"].set_visible(False)
    save(fig, out, "mle_bench_summary")


def axis_window(values: list[float], gold: float) -> tuple[float, float, set[float]]:
    """Range that shows the gold threshold and the bulk of the scores; far outliers are clipped."""
    points = sorted(values + [gold])
    clipped: set[float] = set()
    for _ in range(2):
        kept = [p for p in points if p not in clipped]
        span = kept[-1] - kept[0]
        for candidate in (kept[0], kept[-1]):
            rest = [p for p in kept if p != candidate]
            if candidate == gold or not rest:
                continue
            rest_span = max(rest) - min(rest)
            if 0 < rest_span < 0.3 * span:
                clipped.add(candidate)
                break
    kept = [p for p in points if p not in clipped]
    low, high = kept[0], kept[-1]
    pad = (high - low) * 0.14 or max(abs(high), 1.0) * 1e-5
    return low - pad, high + pad, clipped


def tick_formatter(ax: plt.Axes) -> ticker.FuncFormatter:
    """The fewest decimals that print every visible tick exactly."""
    low, high = sorted(ax.get_xlim())
    ticks = [t for t in ax.get_xticks() if low <= t <= high]
    decimals = next(
        (d for d in range(9) if all(abs(round(t, d) - t) < 1e-9 * max(1.0, abs(t)) for t in ticks)),
        9,
    )
    return ticker.FuncFormatter(lambda value, _: f"{value:.{decimals}f}")


def plot_mle_per_task(methods: list[str], tasks: list[Task], out: Path) -> None:
    """One small panel per task, in two rows; the legend sits above the panels."""
    order = method_order(methods, tasks)
    rows = 2
    columns = math.ceil(len(tasks) / rows)
    fig, axes = plt.subplots(
        rows,
        columns,
        figsize=(7.0, 3.0),
        gridspec_kw={"hspace": 0.6, "wspace": 0.14},
    )
    y = np.arange(len(order))[::-1]
    position = dict(zip(order, y))

    for index, (ax, task) in enumerate(zip(axes.flat, tasks)):
        scores = task.scores()
        low, high, clipped = axis_window(list(scores.values()), task.gold)
        ax.set_xlim(low, high)
        if not task.higher_better:
            ax.invert_xaxis()  # right is better on every panel
        if task.higher_better:
            ax.axvspan(task.gold, high, color=GOLD_ZONE, lw=0, zorder=0)
        else:
            ax.axvspan(low, task.gold, color=GOLD_ZONE, lw=0, zorder=0)
        ax.axvline(task.gold, color=GOLD, lw=1.0, zorder=1)
        ax.hlines(y, low, high, color=GUIDE, lw=0.5, zorder=1)

        left_edge, right_edge = ax.get_xlim()
        for method in order:
            row = position[method]
            ours = method == "Ours"
            if method not in scores:
                ax.text((low + high) / 2, row, "n/a", ha="center", va="center", fontsize=6, color=MUTED)
                continue
            value = scores[method]
            colour = OURS if ours else PRIOR
            if value in clipped:
                at_left = abs(value - left_edge) < abs(value - right_edge)
                edge = left_edge if at_left else right_edge
                inset = (right_edge - left_edge) * 0.04
                marker_x = edge + (inset if at_left else -inset)
                ax.plot(marker_x, row, "<" if at_left else ">", ms=3.4, color=colour, zorder=3, clip_on=False)
                ax.text(
                    edge + (inset if at_left else -inset) * 2.6,
                    row,
                    f"{value:.3g}",
                    ha="left" if at_left else "right",
                    va="center",
                    fontsize=6,
                    color=MUTED,
                )
                continue
            ax.plot(
                value,
                row,
                "*" if ours else "o",
                ms=7.5 if ours else 3.4,
                color=colour,
                mec="white",
                mew=0.5 if ours else 0.4,
                zorder=4 if ours else 3,
                clip_on=False,
            )

        arrow = r"$\uparrow$" if task.higher_better else r"$\downarrow$"
        metric = METRIC_LABELS.get(task.metric, task.metric)
        ax.set_title(f"{TASK_LABELS.get(task.key, task.key)}\n{metric} {arrow}", fontsize=7.2, linespacing=1.15, pad=3)
        ax.xaxis.set_major_locator(ticker.MaxNLocator(nbins=2, steps=[1, 2, 4, 5, 10]))
        ax.xaxis.set_major_formatter(tick_formatter(ax))
        ax.tick_params(axis="x", labelsize=6.2, pad=1.5, length=2)
        ax.set_ylim(-0.7, len(order) - 0.3)
        ax.tick_params(axis="y", length=0)
        ax.spines["left"].set_visible(False)
        if index % columns == 0:
            ax.set_yticks(y, [display_name(m, tasks) for m in order], fontsize=6.6)
            for label in ax.get_yticklabels():
                if label.get_text() == "Ours":
                    label.set_fontweight("bold")
        else:
            ax.set_yticks(y, [])

    spare = list(axes.flat)[len(tasks) :]
    for ax in spare:
        ax.axis("off")
    if spare:
        spare[0].text(
            0.5,
            0.5,
            "Right is better\non every axis.",
            transform=spare[0].transAxes,
            ha="center",
            va="center",
            fontsize=7,
            style="italic",
            color=MUTED,
        )
    fig.legend(
        handles=[
            Line2D([], [], marker="*", ls="", ms=7.5, color=OURS, mec="white", mew=0.5, label="Ours (one run)"),
            Line2D([], [], marker="o", ls="", ms=3.4, color=PRIOR, label="Prior method (mean of runs)"),
            Line2D([], [], color=GOLD, lw=1.0, label="Human gold-medal threshold"),
            Patch(facecolor=GOLD_ZONE, edgecolor="none", label="Gold-medal zone"),
            Line2D([], [], marker="<", ls="", ms=3.4, color=PRIOR, label="Off-axis score (printed)"),
        ],
        loc="lower center",
        bbox_to_anchor=(0.5, 0.965),
        ncol=5,
        fontsize=7,
        handlelength=1.4,
        handletextpad=0.4,
        columnspacing=1.3,
    )
    save(fig, out, "mle_bench_per_task")


# --------------------------------------------------------------------- FrontierScience


@dataclass
class Submission:
    number: int
    olympiad_passed: int  # of 100 Olympiad problems
    research_mean: float  # mean rubric score of 60 Research problems, out of 10
    composite: float  # percent


OLYMPIAD_PROBLEMS, RESEARCH_PROBLEMS = 100, 60


def read_frontier_science(path: Path) -> list[Submission]:
    row = re.compile(
        r"^v[\d?]+\ts(\d+)\t\d+/\d+\t(\d+)\t([\d.]+)\t\d+\t[\d.]+%\t([\d.]+)%\t[\d.]+%\s*$"
    )
    submissions = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = row.match(line)
        if not match:
            continue
        olympiad, mean, composite = int(match.group(2)), float(match.group(3)), float(match.group(4))
        expected = 100 * (olympiad + RESEARCH_PROBLEMS * mean / 10) / (OLYMPIAD_PROBLEMS + RESEARCH_PROBLEMS)
        if abs(expected - composite) > 0.01:
            raise SystemExit(f"{path}: s{match.group(1)} composite {composite}% != {expected:.2f}%")
        submissions.append(Submission(int(match.group(1)), olympiad, mean, composite))
    if not submissions:
        raise SystemExit(f"{path}: no submission rows found")
    return sorted(submissions, key=lambda s: s.number)


def plot_frontier_science(submissions: list[Submission], out: Path) -> None:
    number = np.array([s.number for s in submissions])
    composite = np.array([s.composite for s in submissions])
    best = np.maximum.accumulate(composite)
    olympiad = np.array([100 * s.olympiad_passed / OLYMPIAD_PROBLEMS for s in submissions])
    research = np.array([10 * s.research_mean for s in submissions])

    fig, (left, right) = plt.subplots(
        1,
        2,
        figsize=(TEXT_WIDTH, 2.25),
        gridspec_kw={"width_ratios": [1.18, 1], "wspace": 0.26},
    )
    left.step(number, best, where="post", color=OURS_SOFT, lw=2.0, label="Best so far", zorder=2)
    left.plot(number, composite, "-o", color=OURS, lw=1.2, ms=3.8, mec="white", mew=0.6, label="Each submission", zorder=3)
    first, top, last = 0, int(np.argmax(composite)), len(composite) - 1
    left.annotate(f"{composite[first]:.1f}", (number[first], composite[first]), xytext=(0, 5), textcoords="offset points", ha="center", va="bottom", fontsize=7.5)
    left.annotate(f"{composite[top]:.1f}", (number[top], composite[top]), xytext=(0, 5), textcoords="offset points", ha="center", va="bottom", fontsize=7.5, fontweight="bold")
    left.annotate(f"{composite[last]:.1f}", (number[last], composite[last]), xytext=(0, -8), textcoords="offset points", ha="center", va="top", fontsize=7.5)
    left.set_ylim(0, 65)
    left.set_ylabel("Composite score (%)")
    left.set_title("(a) Composite score", loc="left")
    left.legend(loc="lower right", handlelength=1.8)

    right.plot(number, olympiad, "-o", color=OURS, lw=1.2, ms=3.6, mec="white", mew=0.6, label="Olympiad: pass rate")
    right.plot(number, research, "-s", color=RESEARCH, lw=1.2, ms=3.4, mec="white", mew=0.6, label="Research: mean rubric score")
    right.set_ylim(0, 80)
    right.set_ylabel("Score (%)")
    right.set_title("(b) Per track", loc="left")
    right.legend(loc="lower right", handlelength=1.8)

    for ax in (left, right):
        ax.set_xlabel("Submission (iteration)")
        ax.set_xlim(0.3, number.max() + 0.7)
        ax.set_xticks(range(1, int(number.max()) + 1, 2))
        ax.yaxis.grid(True)
        ax.set_axisbelow(True)
    save(fig, out, "frontier_science_progress")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=REPO / "docs" / "experiments")
    parser.add_argument("--out", type=Path, default=REPO / "docs" / "wechat" / "figures")
    args = parser.parse_args()
    use_paper_style()
    methods, tasks = read_mle(args.data / "mle_bench_gold_thresholds.md")
    plot_mle_summary(methods, tasks, args.out)
    plot_mle_per_task(methods, tasks, args.out)
    plot_frontier_science(read_frontier_science(args.data / "frontier-science.md"), args.out)


if __name__ == "__main__":
    main()
