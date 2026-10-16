"""Spotting Hindi and Punjabi written in Latin letters.

DeepL handles Devanagari and Gurmukhi well, but lyrics are often written out
romanised ("Tere bina kya wajood mera"). Its auto-detect can't place those —
it guesses Wolof, Oromo or Hausa, or hands the line back untranslated — while
the same lines translate properly once it's told the source language.

Nothing here calls a service: it counts words that only turn up in romanised
Hindi or Punjabi. A whole song gives plenty of evidence even when single lines
are too short to call.
"""
import re

# Words that mark a line as Hindi specifically. Kept to words that don't
# double as everyday words elsewhere — 'mein' is German, 'yeh' is English.
HINDI = frozenset('''
    hai hain hoon tha thi raha rahi rahe hum tum aur bhi kya kyon
    woh mujhe tujhe mujhko tujhko humko tumko humein tumhe tumhein
    apna apni apne nahi nahin kabhi kuch kaise jaise liye saath sath bina
    abhi phir jaaunga jaungi chahunga chaahunga lage lagta
    lagti kaha kahin yahan wahan hota hoti
'''.split())

# Words that mark a line as Punjabi specifically.
PUNJABI = frozenset('''
    naal vich wich mainu tainu mennu tenu sanu tuhanu ohnu ae aa hun vi
    kithe kiven kinjh jivein saada saadi saade sadda saddi tuhada
    teriyan meriyan ankhan akhan akhiyan kudi kudiye munda munde
    mundeya jatt jatti billo sohni sohniye gall gallan dass lagda lagdi
    lagde karda kardi karde hoya hoyi hoyiyan jaandi jaanda kol utte
    pichhe dilaan dila yaara rabba sajna
'''.split())

# Words common to both, which still say "this is romanised Indian, not
# English" without saying which language.
SHARED = frozenset('''
    dil pyaar pyar ishq mohabbat yaad zindagi duniya jaan rabb sajan
    yaar mahi mahiya kyun kyu tujh naa koi haan tera teri tere mera meri
    mere
'''.split())

INDIC = HINDI | PUNJABI | SHARED

# Enough English to tell an English line with one stray Indic word apart
# from a Punjabi line with one stray English word.
ENGLISH = frozenset('''
    the you i i'm im me my and to in on it is that this for with be your
    we are was all just like don't dont can know love baby oh got get
    what so when now never ever tonight girl one up down out
'''.split())

WORD = re.compile(r"[a-z']+")
NON_LATIN = re.compile(r'[^\x00-\x7FÀ-ɏ]')

# A song counts as romanised Indic when at least this share of its lines,
# and at least MIN_LINES of them, read as Indic.
MIN_SHARE = 0.3
MIN_LINES = 4


def words(line):
    return WORD.findall(line.lower())


def is_indic_line(line):
    """True when a Latin-script line reads as romanised Hindi or Punjabi."""
    if NON_LATIN.search(line):
        return False   # native script — DeepL detects that itself
    tokens = words(line)
    indic = sum(1 for w in tokens if w in INDIC)
    english = sum(1 for w in tokens if w in ENGLISH)
    return indic >= 1 and indic >= english


def detect_language(lines):
    """'HI' or 'PA' for a romanised Hindi or Punjabi song, otherwise None."""
    if not lines:
        return None
    indic_lines = [line for line in lines if is_indic_line(line)]
    if len(indic_lines) < MIN_LINES or len(indic_lines) < MIN_SHARE * len(lines):
        return None

    hindi = punjabi = 0
    for line in indic_lines:
        for w in words(line):
            hindi += w in HINDI
            punjabi += w in PUNJABI
    return 'PA' if punjabi > hindi else 'HI'
