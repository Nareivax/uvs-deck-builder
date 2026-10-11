"""Run with: python3 scripts/test_cardparse.py"""
import tempfile, os
from cardparse import (parse_keywords, parse_symbols, count_symbols, parse_formats, load_keywords,
                       resolve_keywords, extract_ability_types, load_ability_types,
                       normalize_date, normalize_zone,
                       load_aliases, canonical_name, canonical_requirement,
                       find_spelling_variants)

def check(got, want):
    assert got == want, f"\n got:  {got}\n want: {want}"

# raw keyword tokens (the head can still carry a qualifier)
check(parse_keywords(None), [])
check(parse_keywords("Brawler"), [("Brawler", None, None)])
check(parse_keywords("Fury - Kick - Powerful: 3"),
      [("Fury", None, None), ("Kick", None, None), ("Powerful", 3, None)])
check(parse_keywords("Slam - Combo(Kick)"), [("Slam", None, None), ("Combo", None, "Kick")])
check(parse_keywords("Breaker: 1 - XP"), [("Breaker", 1, None), ("XP", None, None)])
check(parse_keywords("Combo(Difficulty 3 - or less) - Throw"),
      [("Combo", None, "Difficulty 3 - or less"), ("Throw", None, None)])
check(parse_keywords("Powerful: 2(Kick)"), [("Powerful", 2, "Kick")])
check(parse_keywords("Breaker: X"), [("Breaker", "X", None)])
check(parse_keywords("Chun Li: Multiple: 2 - Kick"),
      [("Chun Li: Multiple", 2, None), ("Kick", None, None)])
check(parse_keywords("AlgolCombo(Kick)"), [("AlgolCombo", None, "Kick")])
for bad in ["Bad::token", ": 3", "Combo(Kick) extra"]:
    try:
        parse_keywords(bad)
        raise SystemExit(f"expected ValueError for {bad!r}")
    except ValueError:
        pass

# dates and zones
check(normalize_date("2019-05-24"), "2019-05-24")
check(normalize_date("2010-12-00"), "2010-12-01")
check(normalize_date("2010-00-00"), "2010-01-01")
check(normalize_date("0000-00-00"), None)
check(normalize_date("2021-02-30"), None)
check(normalize_date("soon"), None)
check(normalize_date(None), None)
check(normalize_zone("Mid"), "mid")
check(normalize_zone("low"), "low")
check(normalize_zone("images/icons/block.png?1"), None)
check(normalize_zone(None), None)
check(normalize_zone(""), None)

# symbols
check(parse_symbols("all;evil;void"), [("all", False), ("evil", False), ("void", False)])
check(parse_symbols("at_earth"), [("earth", True)])
check(parse_symbols("all;death;life"), [("all", False), ("death", False), ("life", False)])
check(parse_symbols(None), [])
check(count_symbols("infinity;infinity;infinity"), [("infinity", False, 3)])
check(count_symbols("at_earth;at_earth;earth"), [("earth", True, 2), ("earth", False, 1)])
check(count_symbols("all;evil;void"), [("all", False, 1), ("evil", False, 1), ("void", False, 1)])
check(count_symbols(None), [])

# formats
check(parse_formats("Legacy"), ["Legacy"])
check(parse_formats("Hero Too - Rochester Retro - Retro - Standard - Legacy"),
      ["Hero Too", "Rochester Retro", "Retro", "Standard", "Legacy"])

# keyword list file + resolving tokens (keywords, qualifiers, traits)
real = os.path.join(os.path.dirname(__file__), "..", "db", "data", "keywords.csv")
known = load_keywords(real)
check(len(known), 44)
check(known["powerful"], ("Powerful", True))
check(known["char. trait"], ("Char. Trait", False))

def resolve(s):
    return resolve_keywords(parse_keywords(s), known)

T = "Char. Trait"
# (name, value, detail, requirement)
check(resolve("Brawler"), ([(T, None, "Brawler", None)], []))
check(resolve("E Rank - Hunter"), ([(T, None, "E Rank", None), (T, None, "Hunter", None)], []))
check(resolve("Fury - Kick - Powerful: 3"),
      ([("Fury", None, None, None), ("Kick", None, None, None), ("Powerful", 3, None, None)], []))
check(resolve("slam - combo(Kick)"), ([("Slam", None, None, None), ("Combo", None, "Kick", None)], []))
check(resolve("Breaker: 1 - XP"), ([("Breaker", 1, None, None), ("XP", None, None, None)], []))
check(resolve("Shadow - Shift - Throw - XP"),
      ([("Shadow", None, None, None), ("Shift", None, None, None), ("Throw", None, None, None),
        ("XP", None, None, None)], []))
check(resolve("Combo(Kick) - Combo(Punch)"),
      ([("Combo", None, "Kick", None), ("Combo", None, "Punch", None)], []))
check(resolve(None), ([], []))

# qualified keywords, in every shape seen in the scrape
check(resolve("BrutePowerful: 3"), ([("Powerful", 3, None, "Brute")], []))
check(resolve("DeadlockStun: 2"), ([("Stun", 2, None, "Deadlock")], []))
check(resolve("Deadlock Stun: 2"), ([("Stun", 2, None, "Deadlock")], []))
check(resolve("DesperationBreaker: 1"), ([("Breaker", 1, None, "Desperation")], []))
check(resolve("AlgolCombo(Kick)"), ([("Combo", None, "Kick", "Algol")], []))
check(resolve("Pro HeroBreaker: 1"), ([("Breaker", 1, None, "Pro Hero")], []))
check(resolve("Mighty NeinDeflect: 2"), ([("Deflect", 2, None, "Mighty Nein")], []))
check(resolve("T.HawkDesperation: 5"), ([("Desperation", 5, None, "T.Hawk")], []))
check(resolve("Mr. BraveStun: 1"), ([("Stun", 1, None, "Mr. Brave")], []))
check(resolve("Charlie/GuileBreaker: 2"), ([("Breaker", 2, None, "Charlie/Guile")], []))
check(resolve("1-BBreaker: 1"), ([("Breaker", 1, None, "1-B")], []))
check(resolve("M BisonMultiple: 2"), ([("Multiple", 2, None, "M Bison")], []))
check(resolve("Ranged-Stun: 2"), ([("Stun", 2, None, "Ranged")], []))
check(resolve("MageEX: 1"), ([("EX", 1, None, "Mage")], []))
check(resolve("Chun Li: Multiple: 2 - Kick - Reversal"),
      ([("Multiple", 2, None, "Chun Li"), ("Kick", None, None, None), ("Reversal", None, None, None)], []))
check(resolve("Charlie Only - Desperation: 6 - Multiple: X - Ranged"),
      ([("Only", None, None, "Charlie"), ("Desperation", 6, None, None),
        ("Multiple", None, "X", None), ("Ranged", None, None, None)], []))
# a variable rating
check(resolve("Breaker: X"), ([("Breaker", None, "X", None)], []))
# lookalikes that must stay character traits
check(resolve("Alex"), ([(T, None, "Alex", None)], []))      # ends in lowercase 'ex', not 'EX'
check(resolve("Rally"), ([(T, None, "Rally", None)], []))    # contains lowercase 'ally', not 'Ally'

# ratings glued to the keyword, and [ERRATA] markers
check(parse_keywords("Throw[ERRATA]"), [("Throw", None, None)])
check(parse_keywords("Powerful[ERRATA]: 2"), [("Powerful", 2, None)])
check(resolve("Throw[ERRATA]"), ([("Throw", None, None, None)], []))
check(resolve("Breaker1"), ([("Breaker", 1, None, None)], []))
check(resolve("Desperation4"), ([("Desperation", 4, None, None)], []))
check(resolve("Stun1 - Kick"), ([("Stun", 1, None, None), ("Kick", None, None, None)], []))
check(resolve("Breaker 2"), ([("Breaker", 2, None, None)], []))
check(resolve("BruteBreaker1"), ([("Breaker", 1, None, "Brute")], []))
# traits that merely end in a number stay traits
check(resolve("Big 3"), ([(T, None, "Big 3", None)], []))
check(resolve("1-A"), ([(T, None, "1-A", None)], []))
assert resolve("Throw1")[1], "a glued rating on an unrated keyword should be a problem"

# problems are reported, not guessed
assert resolve("Throw: 2")[1], "rating on unrated keyword should be a problem"
assert resolve("Mystery: 2")[1], "unknown token with rating should be a problem"
assert resolve("Mystery(Kick)")[1], "unknown token with detail should be a problem"
assert resolve("Foo: Bar")[1], "unknown keyword after a colon should be a problem"
assert resolve("Hunter - Hunter")[1], "exact duplicate should be a problem"
assert resolve("Powerful: X(Kick)")[1], "X rating plus detail should be a problem"
check(resolve("Combo(Kick) - Combo(kick)")[0], [("Combo", None, "Kick", None)])
# the same keyword with different requirements is allowed
check(resolve("AlgolCombo(Kick) - PaulCombo(Kick)")[1], [])
no_trait = {k: v for k, v in known.items() if k != "char. trait"}
assert resolve_keywords(parse_keywords("Brawler"), no_trait)[1]

# aliases (spelling variants) and slash lists
from collections import Counter
aliases = load_aliases(os.path.join(os.path.dirname(__file__), "..", "db", "data", "aliases.csv"))
check(aliases["chun li"], "Chun-Li")
check(canonical_name("chun  li", aliases), "Chun-Li")          # case and spacing are ignored
check(canonical_name("Ryu", aliases), "Ryu")
check(canonical_requirement("Benimaru/Goro/Kyo", aliases), "Benimaru/Goro/Kyo")
check(canonical_requirement("Chun Li/Cammy", aliases), "Chun-Li/Cammy")
check(canonical_requirement(" M Bison / Balrog ", aliases), "M. Bison/Balrog")

def resolve_a(s):
    applied = Counter()
    rows, problems = resolve_keywords(parse_keywords(s), known, aliases, applied)
    return rows, problems, applied

rows, problems, applied = resolve_a("Chun LiMultiple: 2 - Chun-LiMultiple: 2")
check(rows, [("Multiple", 2, None, "Chun-Li")])           # both spellings become one entry...
assert problems, "...so the second is reported as a duplicate"
check(resolve_a("T.HawkDesperation: 5")[0], [("Desperation", 5, None, "T. Hawk")])
check(resolve_a("Benimaru/Goro/KyoBreaker: 2")[0], [("Breaker", 2, None, "Benimaru/Goro/Kyo")])
check(resolve_a("Bell's Hells")[0], [("Char. Trait", None, "Bells Hells", None)])
check(resolve_a("Bells Hells")[0], [("Char. Trait", None, "Bells Hells", None)])
check(resolve_a("Chun LiMultiple: 2")[2], Counter({"Chun Li -> Chun-Li": 1}))
# without aliases nothing is rewritten
check(resolve("Chun LiMultiple: 2")[0], [("Multiple", 2, None, "Chun Li")])

check(find_spelling_variants(["Chun Li", "Chun-Li", "Ryu", "Benimaru/Goro/Kyo", "Kyo", "T.Hawk/Guile", "T. Hawk"]),
      [["Chun Li", "Chun-Li"], ["T. Hawk", "T.Hawk"]])

# ability types in rules text, using real card texts
here = os.path.dirname(__file__)
types = load_ability_types(os.path.join(here, "..", "db", "data", "ability_types.csv"))
check(types, {"Blitz": "blitz", "B": "blitz", "Enhance": "enhance", "E": "enhance",
              "Form": "form", "F": "form", "Response": "response", "R": "response"})

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
# leading symbols like {7X} in front of the ability type are skipped
check(ab("{7X} Response Flip: After you play a character card, add it to your staging area.\n\n"
         "Enhance Flip: This attack gains Gauge: X."), (["enhance", "response"], []))
check(ab("{7X}{8Y} Monster Blitz: Draw 1."), (["blitz"], []))
# abbreviated types, as in the scrape: E = Enhance, R = Response, F = Form, B = Blitz
check(ab("E: This attack gets +1 speed."), (["enhance"], []))
check(ab("E Commit 1 foundation: Draw 1."), (["enhance"], []))
check(ab("E Discard 1 momentum: This attack gets +2 damage."), (["enhance"], []))
check(ab("R Flip: After you play a card, draw 1."), (["response"], []))
check(ab("R: After this attack is blocked, draw 1."), (["response"], []))
check(ab("F Commit: Draw 2."), (["form"], []))
check(ab("F: Search your deck."), (["form"], []))
check(ab("Combo E: This attack gets +2 damage."), (["enhance"], []))
check(ab("Brute R Commit: Draw 1."), (["response"], []))
check(ab("B: This attack gets +1 speed."), (["blitz"], []))
check(ab("E: a\n\nR Flip: b\n\nF: c"), (["enhance", "form", "response"], []))
# a word that merely starts with an abbreviation letter is not an ability type
check(ab("Return Fire: Draw 1."), ([], ["Return Fire"]))
check(ab("Rest: Draw 1."), ([], ["Rest"]))
# no abilities at all
check(ab("When you play or check this card, you may add it to the bottom of the arena deck.\n\n"
         "When a player's attack deals damage, each of their rivals loses 3 health."), ([], []))
check(ab(None), ([], []))
check(ab(""), ([], []))
# a header with no known type is reported, not guessed
check(ab("Mystery Move: Do something."), ([], ["Mystery Move"]))

print("all parser tests passed")
