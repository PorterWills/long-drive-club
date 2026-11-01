# Links 2003 Augusta trees -> each game hole's frame (metres), following the game's fairway line. Writes one JSON per hole.
# usage: python3 -I export_trees.py <extracted dir> <live.json from livegame.js> <compare json from compare_live.py> <out dir>
# inputs come from the Augusta/extracted decode (objects_2d.csv, livegame.js, compare_live.py), which is not in this repo.
import json,csv,math,sys,os
E,LIVE,CMP,OUT=sys.argv[1:5]; FT=.3048; os.makedirs(OUT,exist_ok=True)
G=json.load(open(LIVE)); C=json.load(open(CMP))
T=[(float(r['x']),float(r['y']),float(r['height_ft_guess'])*FT,r['family']) for r in csv.DictReader(open(f'{E}/objects_2d.csv')) if r['class']=='tree']
def lerp(pts,z):  # the game's cosine interpolation
    if z<=pts[0][0]: return pts[0][1]
    for (z0,a),(z1,b) in zip(pts,pts[1:]):
        if z<=z1: t=(1-math.cos(math.pi*(z-z0)/(z1-z0)))/2; return a+(b-a)*t
    return pts[-1][1]
def lin(pts,z):
    if z<=pts[0][0]: return pts[0][1]
    for (z0,a),(z1,b) in zip(pts,pts[1:]):
        if z<=z1: return a+(b-a)*(z-z0)/(z1-z0)
    return pts[-1][1]
stats=[]
for g,c in zip(G,C):
    n=c['hole']; F=c['frame']; (tx,ty),(fx,fy),(lx,ly),th=F['tee'],F['f'],F['l'],F['th']
    gp=g['pin']; glen=math.hypot(*gp); px,pz=gp[0]/glen,gp[1]/glen
    llen=c['dist_m']['links_backtee_meanpin']; k=glen/llen          # stretch along the tee->pin line so the Links pin lands on ours
    def tog(x,y):
        u=((x-tx)*lx+(y-ty)*ly)*FT; v=((x-tx)*fx+(y-ty)*fy)*FT
        gx,gz=u*math.cos(th)+v*math.sin(th),-u*math.sin(th)+v*math.cos(th)
        a=gx*px+gz*pz; b=gx*pz-gz*px; a*=k                                # along the pin line (stretched), across it
        return a*px+b*pz, a*pz-b*px
    def stretch(gx,gz):
        a=gx*px+gz*pz; b=gx*pz-gz*px; a*=k; return a*px+b*pz, a*pz-b*px
    line=[[z,x] for z,x in g['fairway']['line']]; GZ=g['green']['at'][1]
    gc=lambda z:lerp(line,z)
    lcl=sorted(([z2,x2] for x2,z2 in (stretch(x,z) for z,x in c['links_cl_full'])),key=lambda q:q[0])
    z0,z1=lcl[0][0],lcl[-1][0]
    def shift(z):  # our fairway centre minus the Links one; zero at the tee (both tees sit at 0,0), held beyond the ends
        if z<=0: return 0
        if z<z0: return (gc(z0)-lin(lcl,z0))*z/z0
        zz=min(z,z1); return gc(min(z,GZ))-lin(lcl,zz) if z<=z1 else gc(min(z1,GZ))-lin(lcl,z1)
    out=[]
    for x,y,h,fam in T:
        gx,gz=tog(x,y)
        if not (-130<=gz<=GZ+150): continue
        gx+=shift(gz)
        if abs(gx-gc(min(max(gz,0),GZ)))>150: continue
        out+= [round(gx*2),round(gz*2),round(h*2),0 if fam.startswith('Pines') else 1]
    json.dump(out,open(f'{OUT}/{n}.json','w'),separators=(',',':'))
    stats.append((n,len(out)//4,os.path.getsize(f'{OUT}/{n}.json')))
print(stats, sum(s[1] for s in stats), sum(s[2] for s in stats))
