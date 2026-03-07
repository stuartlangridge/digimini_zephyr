from machine import Pin
import time

a = Pin(("gpio0", 2),  Pin.IN, Pin.PULL_UP)
b = Pin(("gpio0", 22), Pin.IN, Pin.PULL_UP)
sw = Pin(("gpio0", 24), Pin.IN, Pin.PULL_UP)

position = 0
last_a = a()

def encoder_irq(pin):
    global position, last_a
    cur_a = a()
    if cur_a != last_a:        # A changed — a detent has occurred
        if b() != cur_a:
            position += 1
        else:
            position -= 1
        last_a = cur_a

def switch_irq(pin):
    print("Button pressed, position =", position)

a.irq(trigger=Pin.IRQ_RISING | Pin.IRQ_FALLING, handler=encoder_irq)
sw.irq(trigger=Pin.IRQ_FALLING, handler=switch_irq)

while True:
    time.sleep_ms(100)
