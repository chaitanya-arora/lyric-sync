"""Tests for spotting romanised Hindi and Punjabi.

The lines are written for these tests rather than taken from real songs.
"""
from romanised import detect_language, is_indic_line

HINDI_SONG = [
    'Main tumse pyaar karta hoon',
    'Tum bin jeena mushkil hai',
    'Kya hua jo raat dhal gayi',
    'Aaj phir dil ne kaha',
    'Mujhe kuch nahi chahiye',
    'Tum saath ho toh sab hai',
]

PUNJABI_SONG = [
    'Main tainu yaad karda haan',
    'Dil mera tere naal ae',
    'Kithe chali ae sohniye',
    'Gallan karde raat langh gayi',
    'Munde pind de vich khade',
    'Mainu vi dass de',
]

# Punjabi tracks often switch into English for a verse or a hook
MIXED_SONG = PUNJABI_SONG[:4] + [
    'Baby you know what I mean',
    'We are rolling through the night',
    'Hold me close and never let go',
]

ENGLISH_SONG = [
    'We drive through the city lights',
    'Hold me close and never let go',
    'You are the one I need tonight',
    'Dancing slow under the stars',
    'I keep your name inside my heart',
]

SPANISH_SONG = [
    'Quiero bailar contigo esta noche',
    'Tu eres mi vida entera',
    'Te vi en la playa ayer',
    'Vi la luna sobre el mar',
    'No me dejes nunca más',
]

FRENCH_SONG = [
    'Je pense à toi tous les jours',
    'Tu es mon amour pour toujours',
    'La nuit tombe sur la ville',
    'Je danse seul sous la pluie',
]

GERMAN_SONG = [
    'Mein Herz schlägt nur für dich',
    'Mein Leben ohne dich ist leer',
    'Ich liebe dich so sehr',
    'Mein Traum bist du allein',
    'Mein Weg führt nur zu dir',
]


def test_romanised_hindi_is_hindi():
    assert detect_language(HINDI_SONG) == 'HI'


def test_romanised_punjabi_is_punjabi():
    assert detect_language(PUNJABI_SONG) == 'PA'


def test_english_lines_dont_hide_a_punjabi_song():
    assert detect_language(MIXED_SONG) == 'PA'


def test_english_is_left_to_deepl():
    assert detect_language(ENGLISH_SONG) is None


def test_spanish_tu_and_vi_dont_read_as_indic():
    assert detect_language(SPANISH_SONG) is None


def test_french_is_left_to_deepl():
    assert detect_language(FRENCH_SONG) is None


def test_german_mein_isnt_hindi_mein():
    assert detect_language(GERMAN_SONG) is None


def test_native_script_is_left_to_deepl():
    """DeepL already detects Devanagari and Gurmukhi correctly."""
    assert detect_language(['मैं तुमसे प्यार करता हूँ'] * 6) is None
    assert detect_language(['ਮੈਂ ਤੈਨੂੰ ਯਾਦ ਕਰਦਾ ਹਾਂ'] * 6) is None


def test_a_few_stray_words_arent_a_song():
    """Three Indic lines are too little to override DeepL for a whole song."""
    assert detect_language(ENGLISH_SONG + HINDI_SONG[:3]) is None


def test_empty_lyrics():
    assert detect_language([]) is None


def test_english_line_with_one_indic_word_stays_english():
    assert not is_indic_line('Baby you are my jaan tonight')


def test_short_punjabi_line_with_an_english_word_is_indic():
    assert is_indic_line('Mainu dass baby')
