// Old GroupId (GroupData.csv) -> current group name. Old groups with no clear match (assessments, individuals,
// accounts, drug testing, "Okc", "Shawnee", ...) are left out; clients and attendance from them get no group.
const GROUP_MAP = {
    1: 'Ada SO', 113: 'Ada BIP',
    3: 'Ardmore SO',
    139: 'Chickasha SO 1', 73: 'Chickasha SO 2',
    131: 'Clinton SO 1', 81: 'Clinton SO 2',
    5: 'Duncan SO',
    138: 'Guthrie SO',
    7: 'Lawton SO', 44: 'Lawton BIP',
    114: 'Muskogee SO 1', 34: 'Muskogee SO 2', 123: 'Muskogee BIP',
    8: 'Norman SO 1', 89: 'Norman SO 2',
    20: 'OKC F-SO 1', 18: 'OKC F-SO 2', 41: 'OKC F-SO 3', 58: 'OKC F-SO 4', 60: 'OKC F-SO 5',
    96: 'OKC M-SO 2',
    36: 'OKC W-SO 1', 105: 'OKC W-SO 2', 109: 'OKC W-SO 3', 6: 'OKC W-SO 4', 12: 'OKC W-SO 5',
    11: 'Okmulgee SO', 100: 'Okmulgee BIP',
    14: 'Sapulpa SO 1', 61: 'Sapulpa SO 2',
    141: 'Shawnee M-SO 1', 27: 'Shawnee M-SO 2', 33: 'Shawnee M-BIP',
    50: 'Shawnee Th-SO 1', 85: 'Shawnee Th-SO 2', 76: 'Shawnee Th-BIP',
    130: 'Stillwater SO 1', 137: 'Stillwater SO 2', 72: 'Stillwater SO 3',
    62: 'Tulsa North-SO 1', 43: 'Tulsa North-SO 2',
    64: 'Tulsa SO 1', 25: 'Tulsa SO 2',
    66: 'Tulsa BIP 1', 26: 'Tulsa BIP 2',
    132: 'Woodward SO 1', 45: 'Woodward SO 2',
};

module.exports = { GROUP_MAP };
