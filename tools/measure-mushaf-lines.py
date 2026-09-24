#!/usr/bin/env python3
"""Measure where text lines actually sit on the mushaf page images.

This exists because review.html's MUSHAF_TOP_FRAC / MUSHAF_BOT_FRAC were
inherited from the source project and were simply wrong for these images: a
line pitch of 5.553% against a real ~6.04%. The error compounds down the page,
so bands looked roughly right near the bottom and were nearly a full line out
at the top — on page 4 a band for lines 1-2 rendered at 8.50-19.61% and missed
line 1 (ink at 3.20-6.50%) altogether.

Nothing in the test suite could catch that, because the tests asserted the
formula against its own arithmetic. They now assert against numbers this script
produces.

Run it if the page images are ever replaced, then update both the constants in
review.html and MEASURED_INK in test/tester.test.js.

    python3 tools/measure-mushaf-lines.py

No dependencies: decodes the JPEGs via macOS `sips` into PNG, then inflates and
unfilters the PNG in pure Python (Pillow/numpy are not installed here).
"""
import zlib, struct, subprocess, os, sys, statistics
def read_png(path):
    d=open(path,'rb').read(); i=8; idat=b''; w=h=ct=None
    while i<len(d):
        ln=struct.unpack('>I',d[i:i+4])[0]; typ=d[i+4:i+8]; data=d[i+8:i+8+ln]
        if typ==b'IHDR': w,h,bd,ct=struct.unpack('>IIBB',data[:10])
        elif typ==b'IDAT': idat+=data
        elif typ==b'IEND': break
        i+=12+ln
    raw=zlib.decompress(idat); nch={0:1,2:3,4:2,6:4}[ct]; stride=w*nch
    out=[]; prev=bytearray(stride); p=0
    for y in range(h):
        f=raw[p]; p+=1; line=bytearray(raw[p:p+stride]); p+=stride
        for x in range(stride):
            a=line[x-nch] if x>=nch else 0; b=prev[x]; c=prev[x-nch] if x>=nch else 0
            if f==1: line[x]=(line[x]+a)&255
            elif f==2: line[x]=(line[x]+b)&255
            elif f==3: line[x]=(line[x]+(a+b)//2)&255
            elif f==4:
                pa=abs(b-c); pb=abs(a-c); pc=abs(a+b-2*c)
                pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[x]=(line[x]+pr)&255
        out.append(bytes(line)); prev=line
    return w,h,nch,out

def lines_for_page(pg):
    src=f'/Users/jadnaja/Documents/projects/Quran_memorization/assets/pages/{pg}.jpg'
    png=f'/tmp/_m{pg}.png'
    subprocess.run(['sips','-s','format','png',src,'--out',png],capture_output=True)
    w,h,nch,rows=read_png(png); os.remove(png)
    x0,x1=int(w*0.12),int(w*0.88)
    prof=[sum(1 for x in range(x0,x1) if rows[y][x*nch]<128) for y in range(h)]
    thr=max(prof)*0.06
    runs=[];run=None
    for y,v in enumerate(prof):
        if v>thr and run is None: run=y
        elif v<=thr and run is not None:
            if y-run>=4: runs.append([run,y])
            run=None
    if run is not None: runs.append([run,h])
    # merge runs separated by < 16px (diacritics split a line into pieces)
    merged=[]
    for r in runs:
        if merged and r[0]-merged[-1][1] < 16: merged[-1][1]=r[1]
        else: merged.append(r[:])
    # drop the running header (top ~2.5%) and the tajweed legend (bottom ~7%)
    body=[r for r in merged if r[0] > h*0.025 and r[1] < h*0.925 and (r[1]-r[0]) > 12]
    return h, body

for pg in [3,4,6,50,163,300,450,600]:
    h, body = lines_for_page(pg)
    tops=[r[0] for r in body]
    pitches=[tops[i+1]-tops[i] for i in range(len(tops)-1)]
    print(f'page {pg:3d}: {len(body):2d} lines | first {tops[0]/h*100:5.2f}% | last-end {body[-1][1]/h*100:5.2f}% | pitch {statistics.mean(pitches)/h*100:5.3f}%' if pitches else f'page {pg}: {len(body)} lines')

print()
print("=== validating candidate constants: does every ink run fall inside its slot? ===")
def check(pages, TOP, PITCH, label):
    worst=0; bad=0; tot=0
    for pg in pages:
        h, body = lines_for_page(pg)
        for (a,b) in body:
            ta,tb = a/h, b/h
            # which slot does this ink run's CENTRE fall in?
            mid=(ta+tb)/2
            n=int((mid-TOP)//PITCH)+1
            if n<1 or n>15: bad+=1; tot+=1; continue
            top=TOP+(n-1)*PITCH; bot=TOP+n*PITCH
            tot+=1
            over=max(0, top-ta)+max(0, tb-bot)   # ink sticking out of its slot
            worst=max(worst,over)
            if over>0.004: bad+=1
    print(f'{label:34s} slots missing ink by >0.4%: {bad}/{tot}   worst overflow {worst*100:.2f}%')

pages=[3,4,6,10,11,163,164,300,301,450,451,500,580]
check(pages, 0.085, (0.918-0.085)/15, 'CURRENT  top=.085 pitch=.05553')
check(pages, 0.024, 0.0604,           'CANDIDATE top=.024 pitch=.0604')
check(pages, 0.022, 0.0606,           'CANDIDATE top=.022 pitch=.0606')
check(pages, 0.026, 0.0602,           'CANDIDATE top=.026 pitch=.0602')
