"""Run with: python3 scripts/test_cardparse.py"""
import tempfile, os
from cardparse import (parse_keywords, parse_symbols, parse_formats, load_keywords,
                       resolve_keywords, extract_ability_types, load_ability_types)

def check(got, want):
    assert got == want, f"\n got:  {got}\n want: {want}"

# keywords taken from the scraped samples
check(parse_keywords(None), [])
check(parse_keywords("Brawler"), [("Brawler", None, None)])
check(parse_keywords("Fury - Kick - Powerful: 3"),
      [("Fury", None, None), ("Kick", None, None), ("Powerful", 3, None)])
check(parse_keywords("Slam - Combo(Kick)"),
      [("Slam", None, None), ("Combo", None, "Kick")])
check(parse_keywords("E Rank - Hunter"),
      [("E Rank", None, None), ("Hunter", None, None)])
check(parse_keywords("Breaker: 1 - XP"),
      [("Breaker", 1, None), ("XP", None, None)])
check(parse_keywords("Shadow - Shift - Throw - XP"),
      [("Shadow", None, None), ("Shift", None, None), ("Throw", None, None), ("XP", None, None)])
# edge cases
check(parse_keywords("Combo(Difficulty 3 - or less) - Throw"),
      [("Combo", None, "Difficulty 3 - or less"), ("Throw", None, None)])
check(parse_keywords("Powerful: 2(Kick)"), [("Powerful", 2, "Kick")])
try:
    parse_keywords("Bad::token")
    raise SystemExit("expected ValueError")
except ValueError:
    pass

# symbols
check(parse_symbols("all;evil;void"), [("all", False), ("evil", False), ("void", False)])
check(parse_symbols("at_earth"), [("earth", True)])
check(parse_symbols("all;death;life"), [("all", False), ("death", False), ("life", False)])
check(parse_symbols(None), [])

# formats
check(parse_formats("Legacy"), ["Legacy"])
check(parse_formats("Hero Too - Rochester Retro - Retro - Standard - Legacy"),
      ["Hero Too", "Rochester Retro", "Retro", "Standard", "Legacy"])

# keyword list file + resolving tokens (traits vs keywords)
real = os.path.join(os.path.dirname(__file__), "..", "db", "data", "keywords.csv")
known = load_keywords(real)
check(len(known), 44)
check(known["powerful"], ("Powerful", True))
check(known["char. trait"], ("Char. Trait", False))
check(known["titan"], ("Titan", False))

def resolve(s):
    rows, problems = resolve_keywords(parse_keywords(s), known)
    return rows, problems

T = "Char. Trait"
check(resolve("Brawler"), ([(T, None, "Brawler")], []))
check(resolve("E Rank - Hunter"), ([(T, None, "E Rank"), (T, None, "Hunter")], []))
check(resolve("Fury - Kick - Powerful: 3"),
      ([("Fury", None, None), ("Kick", None, None), ("Powerful", 3, None)], []))
check(resolve("slam - combo(Kick)"),
      ([("Slam", None, None), ("Combo", None, "Kick")], []))
check(resolve("Breaker: 1 - XP"), ([("Breaker", 1, None), ("XP", None, None)], []))
check(resolve("Shadow - Shift - Throw - XP"),
      ([("Shadow", None, None), ("Shift", None, None), ("Throw", None, None), ("XP", None, None)], []))
check(resolve("Titan"), ([("Titan", None, None)], []))
check(resolve("Combo(Kick) - Combo(Punch)"),
      ([("Combo", None, "Kick"), ("Combo", None, "Punch")], []))
check(resolve(None), ([], []))
# problems are reported, not guessed
assert resolve("Throw: 2")[1], "rating on unrated keyword should be a problem"
assert resolve("Mystery: 2")[1], "unknown token with rating should be a problem"
assert resolve("Hunter - Hunter")[1], "exact duplicate should be a problem"
check(resolve("Combo(Kick) - Combo(kick)")[0], [("Combo", None, "Kick")])

# a missing 'Char. Trait' entry is reported when a trait token appears
no_trait = {k: v for k, v in known.items() if k != "char. trait"}
assert resolve_keywords(parse_keywords("Brawler"), no_trait)[1]

# ability types in rules text, using real card texts
here = os.path.dirname(__file__)
types = load_ability_types(os.path.join(here, "..", "db", "data", "ability_types.csv"))
check(types, ["Blitz", "Enhance", "Form", "Response"])

def ab(t): return extract_ability_types(t, types)

check(ab("Enhance Mill 1: This attack gets -1 speed or +2 damage.\n\n"
         "Response [Once per turn]: After you mill 1 or more Psycho cards, add 1 of them to your hand."),
      (["enhance", "response"], []))
check(ab("Combo Blitz: Add the active arena to its owner's discard pile."), (["blitz"], []))
check(ab("Monster Blitz Lose 2 health: This attack gets +4 speed or +4 damage.\n\n"
         "Response: After this attack is blocked, your rival flips 1 foundation."),
      (["blitz", "response"], []))
check(ab("Deadlock Blitz: Ruin 3."), (["blitz"], []))
check(ab("Deadlock Enhance: This attack gets +1 speed."), (["enhance"], []))
check(ab("Brawler Response [Tenacious]: Draw 1."), (["response"], []))
check(ab("E Rank Blitz: Draw 1."), (["blitz"], []))
check(ab("First Form Remove: Remove all face up foundations in play with difficulty 1 or less."),
      (["form"], []))
# 'Enhance' inside the brackets of a Response header does not count as an Enhance ability
check(ab("Before the game begins, search your deck for up to 1 copy of \"Departure\" and add it to your discard pile.\n\n"
         "Response [Twice per Enhance Step, Tenacious]: After you mill 1 or more attack cards, this attack gets +2 or -2 damage."),
      (["response"], []))
check(ab("Blitz Drive 2: Your checks to play Kick attacks get +1 this turn."), (["blitz"], []))
check(ab("Enhance Flip: This attack gets -2 damage. If it is a Throw, it gets -4 damage instead."),
      (["enhance"], []))
check(ab("Enhance [Your turn]: Level up. Only 1 copy of this ability can be played this turn.\n\n"
         "Response: After this card is removed from your hand, build it transformed."),
      (["enhance", "response"], []))
check(ab("Sung Jinwoo begins the game with the Assassin Skill Tree.\n\n"
         "Response [Tenacious] Remove 1 XP card from your hand or stage: At the start of your End Phase, level up."),
      (["response"], []))
check(ab("Response: a\n\nResponse: b"), (["response"], []))
# no abilities at all
check(ab("When you play or check this card, you may add it to the bottom of the arena deck.\n\n"
         "When a player's attack deals damage, each of their rivals loses 3 health."), ([], []))
check(ab(None), ([], []))
check(ab(""), ([], []))
# a header with no known type is reported, not guessed
check(ab("Mystery Move: Do something."), ([], ["Mystery Move"]))

print("all parser tests passed")
