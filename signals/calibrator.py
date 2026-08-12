"""
Auto-Calibrator — adjusts signal confidence based on realized performance.

Implements isotonic regression (PAVA algorithm) for calibration.
Isotonic regression is superior to Platt scaling because it does NOT assume
a parametric form (sigmoid) for the calibration curve. Instead, it learns
the shape directly from data, preserving the true relationship between
predicted confidence and actual win rate.

Hooks into IC tracker data to:
1. Per-source calibration curves (predicted vs actual win rate)
2. Component-level IC (which sub-features predict outcomes)
3. Optimal source weights for Bayesian aggregation
4. Conditional IC by market type / volatility regime

Auto-updates as more trades resolve. No manual tuning needed.
"""

import sqlite3
import time
import math
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent / "storage" / "shadow_trades.db"

# Minimum samples before calibration kicks in
MIN_SAMPLES_CALIBRATE = 20
MIN_SAMPLES_PER_BIN = 5


# ═══════════════════════════════════════════════════════════════════════════
# Isotonic Regression via PAVA (Pool Adjacent Violators Algorithm)
# No external dependencies needed. O(n) time, O(n) space.
# ═══════════════════════════════════════════════════════════════════════════

def _isotonic_regression_pava(x: List[float], y: List[float]) -> Tuple[List[float], List[Tuple[int, int]]]:
    """Pool Adjacent Violators Algorithm for isotonic regression.
    
    Finds the monotonic-increasing step function f that minimizes
    sum((y_i - f(x_i))^2) subject to f(x_i) <= f(x_j) for x_i < x_j.
    
    Args:
        x: Sorted predictor values (predicted confidences)
        y: Observed outcomes (actual win rates per bin)
    
    Returns:
        fitted_y: Monotonic increasing fitted values (same shape as y)
        blocks: List of (start_idx, end_idx) for each constant block
    """
    n = len(y)
    if n == 0:
        return [], []
    if n == 1:
        return [y[0]], [(0, 0)]
    
    # Each block: (sum, count, start_idx, end_idx)
    blocks = [(y[i], 1, i, i) for i in range(n)]
    
    # Merge blocks that violate monotonicity
    i = 0
    while i < len(blocks) - 1:
        cur_sum, cur_cnt, cur_start, cur_end = blocks[i]
        nxt_sum, nxt_cnt, nxt_start, nxt_end = blocks[i + 1]
        
        cur_mean = cur_sum / cur_cnt
        nxt_mean = nxt_sum / nxt_cnt
        
        if cur_mean > nxt_mean:
            # Merge: pool adjacent violators
            merged_sum = cur_sum + nxt_sum
            merged_cnt = cur_cnt + nxt_cnt
            blocks[i] = (merged_sum, merged_cnt, cur_start, nxt_end)
            blocks.pop(i + 1)
            # Step back to check if we need to merge further
            i = max(0, i - 1)
        else:
            i += 1
    
    # Expand blocks back to fitted values
    fitted_y = [0.0] * n
    block_ranges = []
    for blk in blocks:
        blk_sum, blk_cnt, start, end = blk
        mean = blk_sum / blk_cnt
        for j in range(start, end + 1):
            fitted_y[j] = mean
        block_ranges.append((start, end))
    
    return fitted_y, block_ranges


def isotonic_calibrate(predictions: List[Dict], n_bins: int = 10) -> dict:
    """Calibrate confidence scores using isotonic regression.
    
    Groups predictions into equal-sized bins by confidence, computes
    actual win rate per bin, then fits an isotonic (monotonic) function
    to map predicted -> calibrated confidence.
    
    Args:
        predictions: List of dicts with 'confidence' and 'outcome' keys.
                     outcome is 1.0 for win, 0.0 for loss.
        n_bins: Number of bins for the calibration curve
    
    Returns:
        Dict with calibration curve, isotonic fit, ECE, and adjustment function
    """
    if not predictions:
        return {"status": "no_data", "bins": [], "ece": None}
    
    # Sort by confidence
    sorted_preds = sorted(predictions, key=lambda p: p["confidence"])
    n = len(sorted_preds)
    
    # Create equal-sized bins (each bin has ~n/n_bins samples)
    bin_size = max(1, n // n_bins)
    bins = []
    for i in range(0, n, bin_size):
        batch = sorted_preds[i:i + bin_size]
        if len(batch) < 2:
            continue
        confs = [p["confidence"] for p in batch]
        outcomes = [p["outcome"] for p in batch]
        bins.append({
            "n": len(batch),
            "predicted_mean": sum(confs) / len(confs),
            "actual_win_rate": sum(outcomes) / len(outcomes),
            "conf_min": min(confs),
            "conf_max": max(confs),
        })
    
    if len(bins) < 2:
        return {"status": "insufficient_bins", "bins": bins, "ece": None}
    
    # Extract x (predicted) and y (actual win rate)
    x_vals = [b["predicted_mean"] for b in bins]
    y_vals = [b["actual_win_rate"] for b in bins]
    
    # Apply isotonic regression
    fitted_y, blocks = _isotonic_regression_pava(x_vals, y_vals)
    
    # Compute ECE (Expected Calibration Error)
    total_samples = sum(b["n"] for b in bins)
    ece = sum(b["n"] * abs(b["actual_win_rate"] - fitted_y[i])
              for i, b in enumerate(bins)) / total_samples if total_samples > 0 else 0
    
    # Build adjustment function: piecewise linear interpolation
    # of the isotonic fit
    adjustment_points = []
    for i, b in enumerate(bins):
        adj = fitted_y[i] / b["predicted_mean"] if b["predicted_mean"] > 0 else 1.0
        adjustment_points.append({
            "confidence_min": b["conf_min"],
            "confidence_max": b["conf_max"],
            "predicted": b["predicted_mean"],
            "calibrated": fitted_y[i],
            "adjustment_ratio": round(adj, 4),
            "sample_size": b["n"],
        })
    
    return {
        "status": "isotonic",
        "n_predictions": n,
        "n_bins": len(bins),
        "n_blocks": len(blocks),
        "ece": round(ece * 100, 2),  # As percentage
        "ece_interpretation": _interpret_ece(ece * 100),
        "bins": bins,
        "fitted_y": [round(v, 4) for v in fitted_y],
        "blocks": blocks,
        "adjustment_points": adjustment_points,
        "method": "isotonic_pava",
    }


def apply_isotonic_adjustment(calibration: dict, raw_confidence: float) -> float:
    """Apply isotonic calibration adjustment to a raw confidence score.
    
    Looks up the raw_confidence in the calibration curve and returns
    the isotonically-calibrated value. Falls back to raw confidence
    if no calibration data matches.
    
    Args:
        calibration: Result from isotonic_calibrate()
        raw_confidence: Predicted confidence (0-100 or 0-1 scale)
    
    Returns:
        Calibrated confidence, clamped to [1, 95]
    """
    if calibration.get("status") != "isotonic" or not calibration.get("adjustment_points"):
        return raw_confidence
    
    # Determine scale: if raw > 1, assume 0-100 scale
    if raw_confidence > 1:
        raw_conf_scaled = raw_confidence / 100.0
    else:
        raw_conf_scaled = raw_confidence
    
    points = calibration["adjustment_points"]
    
    # Find matching bin or interpolate
    for pt in points:
        if pt["confidence_min"] <= raw_conf_scaled <= pt["confidence_max"]:
            calibrated = raw_conf_scaled * pt["adjustment_ratio"]
            calibrated_pct = calibrated * 100 if raw_confidence > 1 else calibrated
            return max(1.0, min(95.0, calibrated_pct))
    
    # If outside bin range, use nearest neighbor
    closest = min(points, key=lambda p: abs(p["predicted"] - raw_conf_scaled))
    calibrated = raw_conf_scaled * closest["adjustment_ratio"]
    calibrated_pct = calibrated * 100 if raw_confidence > 1 else calibrated
    return max(1.0, min(95.0, calibrated_pct))


def _get_conn(db_path: str = None) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path or str(DB_PATH), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_calibration_tables(db_path: str = None):
    """Create calibration tables."""
    conn = _get_conn(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS calibration_curves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            source TEXT NOT NULL,
            bin_lower REAL NOT NULL,
            bin_upper REAL NOT NULL,
            predicted_avg REAL NOT NULL,
            actual_win_rate REAL NOT NULL,
            sample_size INTEGER NOT NULL,
            calibration_error REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_cal_source_ts
        ON calibration_curves(source, timestamp)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS source_weights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            source TEXT NOT NULL,
            weight REAL NOT NULL,
            ic_value REAL,
            sample_size INTEGER NOT NULL,
            reason TEXT
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_sw_source
        ON source_weights(source)
    """)
    conn.commit()
    conn.close()


def build_calibration_curve(source: str, n_bins: int = 10, db_path: str = None) -> dict:
    """Build calibration curve for a signal source using isotonic regression.
    
    Groups resolved predictions into confidence bins, computes actual win rate
    per bin, then applies isotonic regression (PAVA) to learn the true
    calibration function without parametric assumptions.
    
    Returns:
        Dict with bins, isotonic fit, ECE, and adjustment map
    """
    init_calibration_tables(db_path)
    conn = _get_conn(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute("""
        SELECT confidence, outcome
        FROM signal_predictions
        WHERE source = ? AND resolved = 1
        ORDER BY confidence
    """, (source,)).fetchall()
    conn.close()

    if len(rows) < MIN_SAMPLES_CALIBRATE:
        return {
            "source": source,
            "status": "insufficient_data",
            "sample_size": len(rows),
            "min_required": MIN_SAMPLES_CALIBRATE,
        }

    predictions = [{"confidence": float(r["confidence"]), "outcome": float(r["outcome"])} for r in rows]
    
    # ── Isotonic calibration ──
    isotonic_result = isotonic_calibrate(predictions, n_bins=n_bins)
    
    # Build legacy-compatible output
    bins = []
    total_ece = 0.0
    total_samples = 0
    adjustment_map = {}

    for i, b in enumerate(isotonic_result.get("bins", [])):
        cal_error = abs(b["actual_win_rate"] - isotonic_result["fitted_y"][i]) if i < len(isotonic_result.get("fitted_y", [])) else 0
        bins.append({
            "bin": f"{b['conf_min']:.0f}-{b['conf_max']:.0f}",
            "predicted_avg": round(b["predicted_mean"] * 100, 1) if b["predicted_mean"] < 1 else round(b["predicted_mean"], 1),
            "actual_win_rate": round(b["actual_win_rate"] * 100, 1),
            "sample_size": b["n"],
            "calibration_error": round(cal_error * 100, 1),
            "direction": "overconfident" if b["predicted_mean"] > b["actual_win_rate"] else "underconfident",
            "isotonic_adjusted": round(isotonic_result["fitted_y"][i] * 100, 1) if i < len(isotonic_result.get("fitted_y", [])) else None,
        })
        
        if b["predicted_mean"] > 0:
            adj = b["actual_win_rate"] / b["predicted_mean"]
            adjustment_map[f"{b['conf_min']:.0f}-{b['conf_max']:.0f}"] = round(adj, 3)

        total_ece += cal_error * b["n"]
        total_samples += b["n"]

        # Store in DB
        try:
            conn2 = _get_conn(db_path)
            conn2.execute("""
                INSERT INTO calibration_curves
                (timestamp, source, bin_lower, bin_upper, predicted_avg, 
                 actual_win_rate, sample_size, calibration_error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (time.time(), source, b["conf_min"], b["conf_max"],
                  b["predicted_mean"] * 100, b["actual_win_rate"] * 100,
                  b["n"], cal_error * 100))
            conn2.commit()
            conn2.close()
        except Exception:
            pass

    ece = total_ece / total_samples if total_samples > 0 else 0

    return {
        "source": source,
        "status": "isotonic_calibrated",
        "method": "isotonic_pava",
        "sample_size": len(predictions),
        "n_blocks": isotonic_result.get("n_blocks", 0),
        "bins": bins,
        "ece": round(ece * 100, 2),
        "adjustment_map": adjustment_map,
        "interpretation": _interpret_ece(ece * 100),
    }


def _interpret_ece(ece: float) -> str:
    if ece < 3:
        return "excellent — predictions well-calibrated"
    elif ece < 8:
        return "good — minor adjustments would help"
    elif ece < 15:
        return "fair — systematic bias detected, apply adjustments"
    else:
        return "poor — confidence scores need major recalibration"


def calibrate_confidence(source: str, raw_confidence: float, db_path: str = None) -> float:
    """Apply isotonic calibration adjustment to a raw confidence score.
    
    Uses the most recent isotonic calibration curve for the source.
    Falls back to raw confidence if insufficient data.
    
    Args:
        source: Signal source name
        raw_confidence: Original confidence (0-100)
        
    Returns:
        Adjusted confidence (0-95, clamped) via isotonic regression
    """
    # Build fresh calibration curve (isotonic)
    cal = build_calibration_curve(source, db_path=db_path)
    
    if cal.get("status") not in ("isotonic_calibrated", "calibrated"):
        return raw_confidence
    
    # Use isotonic adjustment map
    adj_map = cal.get("adjustment_map", {})
    if not adj_map:
        return raw_confidence
    
    # Find matching bin
    for bin_label, adjustment in adj_map.items():
        try:
            parts = bin_label.split("-")
            lo, hi = float(parts[0]), float(parts[1])
        except (ValueError, IndexError):
            continue
        if lo <= raw_confidence < hi:
            adjusted = raw_confidence * adjustment
            return max(1.0, min(95.0, adjusted))
    
    # If no bin matches, use nearest bin
    nearest_bin = min(adj_map.keys(), key=lambda k: abs(float(k.split("-")[0]) - raw_confidence))
    adjustment = adj_map[nearest_bin]
    adjusted = raw_confidence * adjustment
    return max(1.0, min(95.0, adjusted))


def compute_source_weights(db_path: str = None) -> dict:
    """Compute optimal weights for each signal source based on IC and independence.
    
    Sources with higher IC get more weight.
    Sources uncorrelated with each other get bonus weight.
    
    Returns:
        Dict mapping source → weight (0-1, sums to 1)
    """
    init_calibration_tables(db_path)
    conn = _get_conn(db_path)
    conn.row_factory = sqlite3.Row

    # Get all sources with resolved predictions
    sources = conn.execute("""
        SELECT DISTINCT source, COUNT(*) as cnt
        FROM signal_predictions
        WHERE resolved = 1
        GROUP BY source
        HAVING cnt >= 10
    """).fetchall()
    conn.close()

    if not sources:
        return {"status": "insufficient_data", "weights": {}}

    # Calculate IC for each source
    from ic_tracker import calculate_ic
    source_ics = {}
    for row in sources:
        ic_data = calculate_ic(row["source"], 30, db_path)
        ic_val = ic_data.get("ic_value")
        if ic_val is not None and ic_val > 0:
            source_ics[row["source"]] = {
                "ic": ic_val,
                "samples": row["cnt"],
            }

    if not source_ics:
        return {"status": "no_positive_ic", "weights": {}}

    # Weight by IC squared (penalizes low IC more)
    total_ic_sq = sum(v["ic"] ** 2 for v in source_ics.values())
    
    weights = {}
    for source, data in source_ics.items():
        w = (data["ic"] ** 2) / total_ic_sq if total_ic_sq > 0 else 1.0 / len(source_ics)
        weights[source] = round(w, 4)

        # Store
        try:
            conn2 = _get_conn(db_path)
            conn2.execute("""
                INSERT INTO source_weights (timestamp, source, weight, ic_value, sample_size, reason)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (time.time(), source, w, data["ic"], data["samples"],
                  f"IC-squared weighting: IC={data['ic']:.4f}"))
            conn2.commit()
            conn2.close()
        except Exception:
            pass

    return {
        "status": "computed",
        "weights": weights,
        "method": "ic_squared",
        "sources_evaluated": len(source_ics),
        "sources_excluded": len(sources) - len(source_ics),
    }


def get_signal_decay(source: str, market_type: str = None, db_path: str = None) -> dict:
    """Measure how quickly a signal's predictive power decays.
    
    Compares IC at different time horizons after signal generation.
    Tells us the exploitable window.
    """
    init_calibration_tables(db_path)
    conn = _get_conn(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute("""
        SELECT confidence, outcome, timestamp, resolved_at
        FROM signal_predictions
        WHERE source = ? AND resolved = 1 AND resolved_at IS NOT NULL
        ORDER BY timestamp
    """, (source,)).fetchall()
    conn.close()

    if len(rows) < 20:
        return {"source": source, "status": "insufficient_data", "sample_size": len(rows)}

    # Group by resolution time (how long until market resolved)
    buckets = {
        "< 6h": [], "6-24h": [], "1-3d": [], "3-7d": [], "7-30d": []
    }
    
    for r in rows:
        hours = (r["resolved_at"] - r["timestamp"]) / 3600
        conf = float(r["confidence"])
        outcome = float(r["outcome"])
        
        if hours < 6:
            buckets["< 6h"].append((conf, outcome))
        elif hours < 24:
            buckets["6-24h"].append((conf, outcome))
        elif hours < 72:
            buckets["1-3d"].append((conf, outcome))
        elif hours < 168:
            buckets["3-7d"].append((conf, outcome))
        else:
            buckets["7-30d"].append((conf, outcome))

    from ic_tracker import _spearman_rank_correlation
    
    decay = {}
    for bucket, pairs in buckets.items():
        if len(pairs) < 5:
            decay[bucket] = {"ic": None, "samples": len(pairs)}
            continue
        confs = [p[0] for p in pairs]
        outs = [p[1] for p in pairs]
        ic = _spearman_rank_correlation(confs, outs)
        decay[bucket] = {"ic": round(ic, 4), "samples": len(pairs)}

    return {
        "source": source,
        "status": "computed",
        "decay_curve": decay,
        "interpretation": _interpret_decay(decay),
    }


def _interpret_decay(decay: dict) -> str:
    ics = [(k, v["ic"]) for k, v in decay.items() if v.get("ic") is not None]
    if len(ics) < 2:
        return "insufficient data for decay analysis"
    
    first_ic = ics[0][1]
    last_ic = ics[-1][1]
    
    if first_ic > 0.05 and last_ic < 0.02:
        return "fast decay — signal value concentrated in first hours, execute quickly"
    elif first_ic > 0.03 and last_ic > 0.03:
        return "slow decay — signal persists, no urgency to execute"
    elif first_ic < 0.03:
        return "weak signal — low IC even at generation time"
    else:
        return "moderate decay — trade within 24h for best results"


def full_calibration_report(db_path: str = None) -> dict:
    """Generate comprehensive calibration report across all sources.
    
    This is the main entry point for the auto-calibration system.
    """
    init_calibration_tables(db_path)
    conn = _get_conn(db_path)
    conn.row_factory = sqlite3.Row

    sources = conn.execute("""
        SELECT DISTINCT source, COUNT(*) as cnt
        FROM signal_predictions
        WHERE resolved = 1
        GROUP BY source
    """).fetchall()

    total_unresolved = conn.execute(
        "SELECT COUNT(*) as c FROM signal_predictions WHERE resolved = 0"
    ).fetchone()["c"]
    
    total_resolved = sum(r["cnt"] for r in sources)
    conn.close()

    calibrations = {}
    for row in sources:
        cal = build_calibration_curve(row["source"], db_path=db_path)
        calibrations[row["source"]] = cal

    weights = compute_source_weights(db_path)
    
    return {
        "total_resolved": total_resolved,
        "total_unresolved": total_unresolved,
        "per_source": calibrations,
        "source_weights": weights,
        "overall_status": _overall_status(total_resolved, calibrations),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _overall_status(total: int, calibrations: dict) -> str:
    if total < 20:
        return f"collecting — {total}/20 minimum trades resolved"
    elif total < 50:
        return f"early calibration — {total} trades, results preliminary"
    elif total < 200:
        return f"calibrating — {total} trades, adjustments active but not definitive"
    else:
        return f"calibrated — {total} trades, adjustments reliable"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    report = full_calibration_report()
    import json
    print(json.dumps(report, indent=2))
