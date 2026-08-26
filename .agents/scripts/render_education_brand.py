import fitz
from pathlib import Path
src = Path('attached_assets/0_EDUCATION_GROUP_New_green_1787769545670.pdf')
out = Path('.agents/outputs/education-brand')
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(src)
print('pages', doc.page_count)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    path = out / f'page-{i+1}.png'
    pix.save(path)
    print(path)
