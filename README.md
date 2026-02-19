# doffamin.site

Cloudflare Pages용 정적 사이트입니다.

## 배포 (Import an existing Git repository)
Cloudflare Pages에서 다음과 같이 설정하면 됩니다.

1. **Select repository**
   - 이 저장소를 선택합니다.
2. **Set up builds and deployments**
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Deploy site**
   - 기본 도메인 예: `my-project.pages.dev`
   - 이후 커스텀 도메인 `doffamin.site` 연결

## 로컬 실행
```bash
npm run build
npm run preview
```
