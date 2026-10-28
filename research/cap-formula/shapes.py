from models import *
import numpy as np
def sal_vec(r, P=None):
    L,el,rem=r['len'],r['el'],r['rem']
    P=P or min(L,5); B=r['bonus']/P
    ys=sorted(y for y in r['years'] if r['years'][y] and y-2027<rem)
    return [ (el+(y-2027), r['years'][y]-(B if el+(y-2027)<P else 0)) for y in ys]
