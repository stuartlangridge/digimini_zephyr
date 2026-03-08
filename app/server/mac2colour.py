COLOURS = [
    ['aqua', '#0ff0fe'],
    ['blue', '#0000ff'],
    ['chai', '#ebcfae'],
    ['clay', '#b66a50'],
    ['cyan', '#00ffff'],
    ['dirt', '#9b7653'],
    ['dove', '#b3ada7'],
    ['ecru', '#c2b280'],
    ['fawn', '#cfaf7b'],
    ['fern', '#548d44'],
    ['flax', '#eedc82'],
    ['gold', '#ffd700'],
    ['grey', '#808080'],
    ['herb', '#708452'],
    ['iris', '#5a4fcf'],
    ['iron', '#5e5e5e'],
    ['jade', '#00a86b'],
    ['kale', '#648251'],
    ['kiwi', '#749e4e'],
    ['lead', '#212121'],
    ['lily', '#c19fb3'],
    ['milk', '#fdfff5'],
    ['mint', '#3eb489'],
    ['moss', '#009051'],
    ['navy', '#01153e'],
    ['onyx', '#464544'],
    ['opal', '#aee0e4'],
    ['pear', '#d1e231'],
    ['pine', '#2b5d34'],
    ['pink', '#ffc0cb'],
    ['plum', '#66386a'],
    ['puce', '#cc8899'],
    ['rose', '#ff007f'],
    ['ruby', '#ca0147'],
    ['rust', '#a83c09'],
    ['sage', '#87ae73'],
    ['salt', '#efede6'],
    ['sand', '#e2ca76'],
    ['silk', '#bbada1'],
    ['snow', '#fffafa'],
    ['teal', '#008080'],
    ['wine', '#80013f']
]
def numberToBase(n, b):
    if n == 0:
        return [0]
    digits = []
    while n:
        digits.append(int(n % b))
        n //= b
    return digits[::-1]

def mac2colour(mac4chars):
    # pass 4 hex digits, "1D5F" or similar (last 4 chars of mac)
    # returns [['cyan', 'gold', 'blue'], ['#00ffff', '#ffd700', '#0000ff']]
    i = int(mac4chars, 16)
    b = numberToBase(i, len(COLOURS))
    cols = [COLOURS[x] for x in b]
    ret = [
        [cols[0][0], cols[1][0], cols[2][0]],
        [cols[0][1], cols[1][1], cols[2][1]],
    ]
    return ret

if __name__ == "__main__":
    print(mac2colour("1d5F"))
