# Match data (`match.json`)

The coach dashboard reads `data/match.json` and plays `data/analysis.mp4`. Both are written by the analysis
model's exporter (`export_dashboard.py` in the model project):

```
python export_dashboard.py --name <run> --site <path to this website> --team-names Australia India ^
    --title "Australia vs India" --competition "FIBA U16 Asian Championship 2023" --date 2023-09-17 --venue "Doha, Qatar"
```

All times (`t`, `t0`, `t1`) are **seconds of `analysis.mp4`** (0 = its first frame). Team `0` and `1` index `teams`.

## Shape

```json
{
  "format": 1, "sample": false,
  "title": "Australia vs India", "competition": "…", "date": "2023-09-17", "venue": "Doha, Qatar",
  "clip": { "source_start_s": 10, "source_end_s": 120, "duration_s": 110, "fps": 15 },
  "video": "data/analysis.mp4",
  "teams": [ { "id": 0, "code": "AUS", "name": "Australia", "points": 6, "points_confirmed": 3,
               "fgm": 2, "fga": 3, "tpm": 2, "tpa": 3, "ftm": 0, "ball_control_pct": 49.4,
               "passes": 14, "interceptions": 1, "distance_m": 778,
               "unidentified": { "seconds": 54, "distance_m": 126, "…": 0 } } ],
  "players": [ { "team": 0, "no": "4", "seconds": 62.5, "pts": 3, "fgm": 1, "fga": 2, "tpm": 1, "tpa": 2,
                 "passes": 1, "received": 3, "int": 0, "distance_m": 98.3, "avg_kmh": 5.7, "top_kmh": 12.9, "ball_s": 1.7 } ],
  "shots": [ { "t": 56.1, "team": 1, "no": "7", "player": "IND #7", "kind": "field_goal", "made": true,
               "points": 3, "value": 2, "confirmed": true, "near_line": true, "distance_m": 6.74,
               "x": 5.36, "y": 5.66, "zone": "Above-break 3" } ],
  "plays": [ { "t": 2.3, "type": "pass", "team": 1, "from": "IND #7", "to": "IND #36" },
             { "t": 7.2, "type": "interception", "team": 0, "player": "AUS #2", "from": "IND #36" } ],
  "possession": [ { "t0": 0, "t1": 7.3, "team": 1 } ],
  "pass_network": [ { "nodes": ["2", "4"], "edges": [ { "from": "5", "to": "2", "count": 3 } ] } ],
  "tv_score": { "readings": [ [54.0, 15, 2] ] },
  "heat": { "cell_m": 1, "cols": 28, "rows": 15, "teams": [ [[0.0, "…"]] ], "players": { "0-4": [[0.0]] } },
  "speed": { "0-4": [ [0.0, 6.2] ] },
  "quality": { "ball_holder_known_pct": 62.4, "players_with_number_pct": 86, "notes": ["…"] }
}
```

## Notes

- **Shot positions** (`x`, `y`) are metres on a FIBA half court seen from above the basket: `x` runs across
  (−7.5 to 7.5, 0 is the middle), `y` runs out from the endline. The basket is at `x: 0, y: 1.575`.
  Both teams' shots are folded onto the same half court. `null` when the shooter's position was not measured.
- **Points** follow FIBA rules: free throw 1, released inside the 3-point line (or on it) 2, beyond it 3.
  `points` is the scored value (from the TV scoreboard when `confirmed`), `value` is what the shooter's position gave.
- **Zones:** `Paint`, `Mid-range`, `Corner 3`, `Above-break 3`, or `Free throw`.
- **Heatmaps** are seconds spent in each 1 m × 1 m cell of the full 28 × 15 m court (`rows` × `cols`).
  Player keys are `"<team>-<number>"`.
- **Players** lists only players whose jersey number was identified; the rest is summed in each team's `unidentified`.
- `tv_score.readings` are `[t, left team score, right team score]` read from the broadcast scoreboard (left = team 0).
- The video must be **H.264** (the exporter converts it): browsers do not play the older MPEG-4 Part 2 format.
