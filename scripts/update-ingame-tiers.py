#!/usr/bin/env python3
"""Refresh factual Smogon in-game tiers; no article prose is bundled.

Uses Python's standard library. Sources: Smogon's guide headings and PokéAPI's
pokemon_species/pokemon_evolution CSVs. Run manually, review the generated diff,
then run the tier tests. This is not part of the offline production build.
"""
import csv
import io
import json
import re
import unicodedata
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
GUIDES = [
    ('rby', 'rby_ingametiers', ['Red', 'Blue', 'Yellow'], 1, 1, 3, 4),
    ('frlg', 'adv_frlg_ingametiers', ['FireRed', 'LeafGreen'], 3, 1, 3, 4),
    ('rse', 'adv_rse_ingametiers', ['Ruby', 'Sapphire', 'Emerald'], 3, 3, 2, 3),
    ('dp', 'dpp_ingametiers', ['Diamond', 'Pearl'], 4, 4, 2, 3),
    ('platinum', 'dpp_plat_ingametiers', ['Platinum'], 4, 4, 2, 3),
    ('hgss', 'hgss_ingame_tier', ['HeartGold', 'SoulSilver'], 4, 4, 3, 4),
    ('bw', 'bw_ingametiers', ['Black', 'White'], 5, 5, 3, 4),
]


def fetch(url):
    return urlopen(Request(url, headers={'User-Agent': 'Effortdex reference-data updater'})).read().decode()


def normalized(text):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', text).lower())


class Headings(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.parts, self.tag = [], [], None

    def handle_starttag(self, tag, attrs):
        if tag in ('h2', 'h3', 'h4'):
            self.tag, self.parts = tag, []

    def handle_data(self, text):
        if self.tag:
            self.parts.append(text)

    def handle_endtag(self, tag):
        if tag == self.tag:
            self.rows.append((int(tag[1]), ''.join(self.parts).strip()))
            self.tag = None


def main():
    csv_base = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/'
    species = list(csv.DictReader(io.StringIO(fetch(csv_base + 'pokemon_species.csv'))))
    evolutions = list(csv.DictReader(io.StringIO(fetch(csv_base + 'pokemon_evolution.csv'))))
    by_name = {normalized(row['identifier']): int(row['id']) for row in species}
    by_id = {int(row['id']): row for row in species}
    children = {}
    for row in species:
        if row['evolves_from_species_id']:
            children.setdefault(int(row['evolves_from_species_id']), []).append(int(row['id']))
    trade_ids = {int(row['evolved_species_id']) for row in evolutions if row['evolution_trigger_id'] == '2'}

    def descendants(root, cap, no_trade=False):
        result = [root]
        for child in children.get(root, []):
            if int(by_id[child]['generation_id']) <= cap and not (no_trade and child in trade_ids):
                result.extend(descendants(child, cap, no_trade))
        return result

    result = []
    for key, slug, games, gen, evo_cap, tier_level, name_level in GUIDES:
        url = 'https://www.smogon.com/ingame/guides/' + slug
        parser = Headings()
        parser.feed(fetch(url))
        tier, tiers, entries = None, [], []
        for level, text in parser.rows:
            if level == tier_level:
                clean = text.replace('Т', 'T').replace('–', '-').replace('—', '-')
                match = re.fullmatch(r'([SABCDEF])\s*[- ]?\s*tier', clean, re.I)
                legacy = re.fullmatch(r'(High|Middle|Low|Bottom)\s+Tier', clean, re.I)
                tier = match[1].upper() if match else legacy[1].title() if legacy else None
                if tier and tier not in tiers:
                    tiers.append(tier)
            elif level < tier_level:
                tier = None
            if not tier or level != name_level:
                continue
            match = re.fullmatch(r'(.*?)(?:\s*\((.*?)\))?', text)
            name, condition = match[1].strip(), match[2] or ''
            root = by_name.get(normalized(name))
            if root is None:
                raise ValueError(f'Unrecognized species heading in {slug}: {text}')
            branch = by_name.get(normalized(condition))
            if branch:
                path, cursor = [], branch
                while cursor != root:
                    path.append(cursor)
                    parent = by_id[cursor]['evolves_from_species_id']
                    if not parent:
                        raise ValueError(f'{condition} is not a branch of {name}')
                    cursor = int(parent)
                ids = [root, *path, *descendants(branch, evo_cap)]
            else:
                ids = descendants(root, evo_cap, normalized(condition) == 'notrade')
            only = [game for game in games if re.search(r'\b' + re.escape(game) + r'\b', condition, re.I)]
            if condition in ('RB', 'R', 'B', 'Y'):
                only = {'RB': ['Red', 'Blue'], 'R': ['Red'], 'B': ['Blue'], 'Y': ['Yellow']}[condition]
            entry = {'tier': tier, 'ids': sorted(set(ids)), 'entry': text}
            if only:
                entry['games'] = only
            entries.append(entry)
        if len(entries) < 20:
            raise ValueError(f'{slug}: only {len(entries)} entries; inspect source markup')
        print(f'{key}: {len(entries)} entries, tiers {", ".join(tiers)}')
        result.append({'key': key, 'games': games, 'generation': gen, 'url': url,
                       'checkedOn': str(date.today()), 'tiers': tiers, 'entries': entries})
    output = '// Generated by scripts/update-ingame-tiers.py; factual rankings only.\nexport const INGAME_TIER_DATA = [\n'
    for guide in result:
        entries = guide.pop('entries')
        output += '  ' + json.dumps(guide, ensure_ascii=False)[:-1] + ', "entries": [\n'
        output += ''.join('    ' + json.dumps(entry, ensure_ascii=False) + ',\n' for entry in entries)
        output += '  ]},\n'
    output += '];\n'
    (ROOT / 'lib/ingame-tiers-data.ts').write_text(output)


if __name__ == '__main__':
    main()
