import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync } from 'child_process';
import {
  buildTitleFilter,
  buildLocationFilter,
  loadSeenUrls,
  loadSeenCompanyRoles,
  companyRoleDedupKey,
  buildCompanyCanonicalizer,
  formatScanHistoryRow,
  formatPipelineOffer
} from '../scan.mjs';

const candidatesRaw = [
  // Query 1: Ashby — Senior Frontend
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEWv2bGK2qdIX8cF3Tu5dmiZjvmpRt9WtsZj8iyPbalWw6gDHmU8YYmApMtl5IR8bFlA1qVYJZDmEocpti73BbeGpQGduSTQJ-sTNJpfDAnuoQ5l8qFmMyy_Z1-IdsuLi-Irj-Fbq3TkU0OnxQl6MmAGB30kT_GVAS0",
    company: "HTTPie",
    title: "Senior Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "Prague (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGD_y5r_Vt1BVVHJukmCkxdC6wzEKhJMSkkRUHcfByGQ9xvlHGzSrxNboot_hd58kqih-acKYW3f0tY2E4Dq30MqquygbV-pmwipJIYzrrjIJJprn9IRo3fog5wRH1dCR9RDa3_PSAXaWKhGTXBQmGoC0l-t_e5GuamHPbp3ZymiUeF",
    company: "Reactive Markets",
    title: "Senior Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "UK (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGByeDxN1HoU_P3JgXMOe-UTmdMy8Wit9sJlVVSFVY6jlabQVunVJTYbLIDLYN-rfYX9FmdIy97q-NwFAV6jSWLqwZPz_C72NGe0dFEo4SwmCI1RfXTJS4FJjy0r1_P9WgQacz8aQFpfPvXshRHrwvCoWfQkSMhAU0=",
    company: "Close",
    title: "Senior Frontend Engineer – Growth",
    portal: "Ashby — Senior Frontend",
    location: "USA (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFmpVLoV8SpcpqMNdpMfgfgTuSbiromhWKZfWRT-66PvqfnWNl9ScLGJjrALEZjCRmZCKnNXHRiNbt8gKWFEGI_furfU6OMqpV11rkdcFjHkB2xXU3kNI64t5ByZjroLUqTXOuVkTx1DWHL7RIYCEX2bOetm7GWn7x67JM=",
    company: "Deepgram",
    title: "Senior Frontend Engineer, Console Team",
    portal: "Ashby — Senior Frontend",
    location: "USA (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGlZP08hFNz-Ct19Z7g6fvp_EOrBKaPHzp-z3rBZVmpYHbwmyNV9zib9UDDZpAbKt1njVDhGjVuHOW3gwtdGfsVKbRaH0EZm3YGioj4rzHtymlXZs8aW7nmhWHsQ2bucELlOzFdcVjp3ytn2HzUG-XQ8Mm2rEsKgaZuCdHIZw==",
    company: "Grid",
    title: "Senior Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF5SNs8SUxHWcGO1C9pFDfMzHx8EO6vQerKrtxfL0WYhJnBjO5FXzkmmX8LHs3xkRQaD3g5TTwdNdzAqcWFPm4PpoRfvTCYaO-YJJE95q2N-3lK615uR7R_vrSjksQp2PKxsSUhWtA9GQD9E2rFTYedlR0jTXl--d-6edI=",
    company: "Provable",
    title: "Senior Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEcZWEPnUSz1RWxc4fvYx0dox6ty2ZnXtrbW8eYp6WwwxwCk7PVimRh_vBBuBB7rxeXll7bq_P4fdiAKr4IHX1Cjq-C9T-IbGntjEjvUmtZU8CGjo8zFGberrUifaErEUOdZ90R2WiE1gYC_PQ5PpuWy9zhDSYgZkiQ",
    company: "Reedsy",
    title: "Senior Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "Europe (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGCMLtE0e5x2W4filjmEz9BcoM95WTWd_l0WiSdCZeo-JbFwvLfhMPaQ3MWgqEnWzG1fmTdDGLewTlM4zNXeznLRUQa0e_QJAwPKU9-lWPbLLShordCz407ODnqvMO59yCwSTNSFSUhHx-S95Y6oOycfApOizqR3fWomoZV_x8pQ3_hKA==",
    company: "ClickUp",
    title: "Staff Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHz16ucR8lffCVHpl3nXVnQbHDHb0EZSRZMW2FloSEcHpytezt8TiAauu1dMWra2rJromeuC4vopD8LFrOF01OxdEMtfgsxBGw9cM8N_U0kyWi66VfxPKA01l_ZGRz_OYFr90-Bf3XVheHaIbiHXcO2Kxr6iXhhNWin2DloRMmkWK2fLA==",
    company: "ClickUp",
    title: "Staff Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGjoUUhNbtlUQ1zDBep-7TNvl1ScvqrrckqaE_iAISV_d6NeKnSiFK4icRobYoA9-XGxBP9RRVifO-LnDEhwfj3DUVpWpRTqgGaohEqAD8DkAQS6W2StaGd7dMDhTtaezh-frGJjy4613bopdmPBd0PBJ73WYjJ0a9wDA==",
    company: "Vetcove",
    title: "Staff Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEj_9Yh4NRjZWsrWr7SlCX5XsGCRAb9Ch4m7pYYrHB3-XdOWcEDOsqbkAP3Va2bnmKZwt6hlTAR73UyG-JaFDDEuhTL2vMlliduEOvdyd9W7y7_0I2qzLnc4exYv_apIBgfLzGaigB9oG54ci286y2qM79-B_Rv_9bX_ZdzRLiwtg==",
    company: "Douro Labs",
    title: "Staff Frontend Engineer",
    portal: "Ashby — Senior Frontend",
    location: "Remote, North America"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHVfWrzffn97pvGLpsnOSTTAuzuuFHfwVe52zM968Ew4B882zrCSom7YqN11U78ADYjApx3B_wwY3NrOV5Yk7DF0QgOwRADXhpAKzDWoY6q9NwbPNtumyJrf5yzJmb6Z-3qrZhJDs-pX8OeLGGq_1FxI_zZcX0GiqcBSUJ_",
    company: "Sound.xyz",
    title: "Staff Software Engineer, Frontend",
    portal: "Ashby — Senior Frontend",
    location: "Remote, North American timezones"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEfoEoJZJdZtFZTIPG0xdHxl7KHJ-z0W-eIIxyJSZ7Vk2CIjZQbx9tX_figeNTp6KjfqY_EY7J7MLH5CrWdTPsHpWRai-uaDkGuAXnpU6C_T8Nvd-TFyQWiVhscLpXWAaqmvpRx9Uxx4X-lMYTDWrBFd3gMgPgfvA==",
    company: "Pleo",
    title: "Staff Frontend Engineer - Design Systems",
    portal: "Ashby — Senior Frontend",
    location: "Remote, Denmark/Portugal/UK"
  },

  // Query 2: Ashby — Senior Full-Stack
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEtn13SPwWN5tXpbprSDo9faIP2LzF_RoaE0PdX9vI9ND_jylNWCtjOnW9P9FJrcWkL_heAfhuH23uDZ0JDO5ysmassMxA_cMzme7aLjFDWgONa-4C0h_oCiyCzTm_3PHI3qGlJeDx0wArqjOA5-bDcXfVqjjQ89_FKwDyi",
    company: "GridUnity",
    title: "Senior Full Stack Engineer",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHsydjW5mKwzJ_MmKSPEZK1Gaj6eCbr2Mde9-Aj4MtZuLNEyHX99LwuOw_GVN8Mo6kVcPfFE2gM3X7EugkKGRrvK-MuMGMvyKp5ytd4LEjIkNYhUTVfB-HBt0wcHv9U7oQUUz05lhPhHS_Hhr1coALCB_2hM3fYQDYUud5ZEQ==",
    company: "Pragmatike",
    title: "Senior Fullstack Engineer",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote - EMEA region"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFKK4UiJ8icTXGmShTlrg9Zb3CPVxv33dDTUP7D22kWhSCftKH0uRf0oFI6JyPX7TYh_dZR3GZDPxyhpqkedAG-JxabUPr8ztRWX1w7nMsSqTl8pWpvICBl-J0WDxUXZ1HPBt6uCoxPF8f67nGaqDyLaq4pgS0kQr5vXU8=",
    company: "Zencastr",
    title: "Senior Fullstack Engineer",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQElQaSrq7I_sDbHqIMnAe3bLgaJt2MaOHic83j1ptfJWqFhyTE1lPvK-nj-7sMDkabn3jQHyixz-xb8jlwY5Qjb_2_yZV_aBxGgwkGJyn3z9-r5WQPuePbAkwreRWFvgmgC6xkTNMBrkBjuQYjNi5S1byHyK9HduSza",
    company: "Natter",
    title: "Senior Fullstack Engineer",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote - GMT +/- 3hrs"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEtzDsnuJ7n0gG6IVbpqrJD77kLGycQUcgpHN58II-AlMTOM8Z2rbp0RYZ7WCcJGGOuuLiki2iYcsPQiMi4fmasKhyiwGAz5qoYgY2nXRtOHvGUQmzAtSllGcEoZq50qrGYv8EL2pcMfVL3tdE_4e5ccFaRa-HW5FLq",
    company: "HTTPie",
    title: "Senior Fullstack Engineer",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote - Prague"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEvq1HANI2awFRHp7U447jecIg4RW0RHKdUUTQbPOcuaU-EAu44YP40u8ULmOYuWTVmQSS3Wdy38BwZR_VNxW-gYZzi4UPvQ-uQtZsoFwHBSWyOSRpul115fNPe4hTORo7dFsSTO4Df3OunS7It6Gx4-L4AHAoFxHAu2g==",
    company: "Clarium",
    title: "Senior Fullstack Engineer",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEOrTiQNALkB_xKs7l5ZxN50nFpWLfeWJyf-MCcwvQCRbhxd_sn7inCeEqrs0OBjAH4-5CED8_xynPATKbkuUMW15ttfnMzbf2t10_AXUrI4rfYWKlUccb1uE7c27B3wv7AUhnlFgtoshWzCOFFp5-hd7cPfiug_ubIlShK",
    company: "RxVantage",
    title: "Senior Full Stack Engineer - Team Lead",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHLZxCXV4tZVfN9OJ526tdy4H0SdM5RmZpLLHooMUpAuma1xlyT-WrH_bW3XJXsZUG2NffKZ_HFYom94qtWcAk5OIOxT0jf2LP1OZ8W3VhnhfhXsbPOlgdfyFv9-COTfaS0CjEQOm9YDIBNtDlM2-kbypcpMHY8dzN6",
    company: "Tolken",
    title: "Senior Full Stack Engineer",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote - India/Global"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGrNEX3kQIg_XG0_yyfSkVLOgg2qAJPIKgx_f7Nc3anogEtAHsFqfbOkDlaHL_LLvdhRiUU79iv5-0316Pn1c5DSOka0b2DJIoMwbbUOq9DKIB-QoK4kPdLfgO7bcnOBIYMJwjpBEzrI5-_m06Wl3k-3nxrDv4xnTBd4g==",
    company: "Commure Pro",
    title: "Senior Fullstack Engineer",
    portal: "Ashby — Senior Full-Stack",
    location: "Remote - US"
  },

  // Query 3: Ashby — Product Engineer
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGIeVxZFR_xCsz7IsDSxIHKhnpAgTPtE-gVKy_iZdRzaLPynS_cc6L5fNIUDjWJ_1vm9yNlb6ybJSBJkPU1RnlCI4lVU8MKoZ77b6emn3cfIWZBDlgRqfYZLA1mPNEJQF-s_gnOzBPai3irNdY5AaZ_t-8O5J0xWiAG",
    company: "Ashby",
    title: "Senior Product Engineer - Americas",
    portal: "Ashby — Product Engineer",
    location: "US (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF59Pv0tgTo7CU9f0crw9axS2c8xFkqzsiLyH7ZvDkiphn_wNAXGAKqvoJr_Dbj8mKa8m4jQybbhXwBBsPusfGId00xyabnZhqZSiRjzb5ZyYsNF5nll0V2fUO8xnDj5vTr2ChpTSDbuBu2PE-EznW6Urff72IXqU3YTj5GpTpgpn1Avs3U4wHXj47EAQlVc9Wl7zo=",
    company: "Playbook",
    title: "Senior Product Engineer (TypeScript)",
    portal: "Ashby — Product Engineer",
    location: "Remote-first"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGTkOPzrW7AJfJl-fqDpfKixHotw_Gv5R_PBf6eCVI7o5qcF9sGHtuTnPlkMAxJZVyG4fBmkg3mvFmX16pv_Edmn4t3i8m7iH_lmtjW6RQQkzX33w0HWaVEnPhczAovd1PQ-yN-HmYsZSjxJzI8JRUYbz-QuO3dcTai0atpFz4=",
    company: "Maze",
    title: "Senior Full Stack Product Engineer (TypeScript)",
    portal: "Ashby — Product Engineer",
    location: "Remote (Netherlands, UK, Ireland, Spain, Portugal, Canada)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGjXm9CntGoomk10Ul2TGs68_2J4fdGsa1kKVUjXYn8Ltp_X7qjCPflNdaSngfAfV-aKie3Lnoz-cW5e2ZQAxwjJOJK16Jic_lUbtINukBtaXAlm-vHpgFwwKTwN7OcC9CJ5_BAwQka9ffuitkH1CUvSPhwrtXm0Dvtfw==",
    company: "cfo.ai",
    title: "Senior/Staff Product Engineer",
    portal: "Ashby — Product Engineer",
    location: "Remote (North America)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGCesAioUHehpY62Z0CK6oF4cFO0Fgr09Qq7dId74QstpqIzh0k7g2Fn-mqw2pnWMKCyDcctyzID8dfBD1kIDacqhcWD886W6P5x39NMnprC61YEomE6q8FXwf2ZTUGALH0_zHoDXUUEstCMrclrbxHMFx3isqCNc7y",
    company: "Polar",
    title: "Senior Product Engineer",
    portal: "Ashby — Product Engineer",
    location: "Remote-first (Europe)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG5yraVKL7tD88gG8RzEpRj8fYWXMxt4USBiosqNES3Jz_Cu4z7UcEvuRAoXENbOaxmZeblyP-kRv_oNoVY0VdCM51xk3J0_DtXOxg_oVQzQi6BMQCKZPqmuN2fO4_er5D6t4xastQJ3VceQdl3haRbYeKLdDcWxpbL8Mei2W5ZyAXZ4Q==",
    company: "Vic.ai",
    title: "Senior Product Engineer, Treasury (Elixir)",
    portal: "Ashby — Product Engineer",
    location: "Remote (US-based, EST hours)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF7Aaf-0sn0e7OilszDSrLYMcNehE7n7tb4HSG-r7sisKptYS3gqmm6vDjoA9hf6xZLntHYHCwFO7kTc_DbHOob7DpHyvEV7qRrCXcBedfFfJwrUl4EyDAhVypnjbYQjp7WjeNFfIVuQtPqvmQV5KvOS1AA2rexhZjnmTU=",
    company: "LiveKit",
    title: "Senior Product Engineer",
    portal: "Ashby — Product Engineer",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFwNURt0cip_wTfgmk4kklnTNXxgq0saxzmqX--awcNa6aE836diAddNh_xR1szLi2nV3HSqs7K5fZ-XwHvlvYR0RxLeun4lVNvACjNkIPm6WxsGHvaI13N6OkHc9WNdyTIVae-2bVpVQ14D9Qb1YlIdPEBsRElvg5QP5k=",
    company: "9amHealth",
    title: "Senior Product Engineer",
    portal: "Ashby — Product Engineer",
    location: "Remote (United States)"
  },

  // Query 4: Greenhouse — Senior Frontend
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGzboKuZ2CJtzEIkelkb7uQR-61k8Kwc4gdhvrq9WV58wfDZHDR8udepvF3JBHmTqQkWpefQN5NDfDxBr7IABqmdgHUjN6CZlIi66lEkWOsQN1XWjBLj8xajLXJ0mILYvCf3YwEcLj4mYg=",
    company: "Reddit",
    title: "Staff Frontend Engineer, Ads Creative",
    portal: "Greenhouse — Senior Frontend",
    location: "Remote - United States"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFTJJWYiHf4rGlmRzhbHXVUwzxGL15jb9e5Dk63KVKDfIOFh1JkRR34XJ4Ltdx4cF5qijrt6KrhJOzjIRugBd3lhdtePvLhtY0e2hCJmDyC2CQ2KaQ4elRzVYVMAH1hICr8BdYyB70GqoXNAyys2FozAMA=",
    company: "Machinify",
    title: "Sr/Staff Frontend Engineer | Web Products",
    portal: "Greenhouse — Senior Frontend",
    location: "Remote - US"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEj7o1PXGrTLCoO7m0ArInNt3fPb8w9KqY--WcnpTqWcMYc4n6O2KTmVJQrZVAZjMEL4vM94Cpw268HFiUqgohiWhvg5WlX1KwlSrnrLPrgDqEK0KYXN72K6w07_t06Axu_AleYfHQ6NGxuueM=",
    company: "Future",
    title: "Staff Frontend Engineer",
    portal: "Greenhouse — Senior Frontend",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHggudaywfQChkMunpkld3ySITzURQjbihHS15MqODhQJYK25jCR5qAjAHYBsRryg-uY7x6z_9URSTPdwofWEal2g1R9XJxVSOuECQYCiTsUoJSs_Dr4ym1e-uecBw2ZYSrOt9AiGd4rEanLRkba4o=",
    company: "Cloudbeds",
    title: "Senior Frontend Engineer",
    portal: "Greenhouse — Senior Frontend",
    location: "Remote (North America)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGjUUTVncvjSbcq0hbDY8cUpEMKhpKilHr2DxTHOffDZ2jYsqzh-QkMprwUB1DpueOEy2czaUB5K0iA4MnIqi1zty0ZDWyP9DdNjMU7GYskiWyxkyVF4PPRm3q2yP5omc4aGmat5M3oCVKYC37NZw==",
    company: "Lumimeds",
    title: "Senior Frontend Engineer (Next.js & React, AI-Native)",
    portal: "Greenhouse — Senior Frontend",
    location: "Remote (LATAM / South America / Eastern Europe)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE6pMZ-_enKmFyQj1oJT4XwjzTPzaz__YrPKN-kSkBRfd2qW4kaUKUnN4eoHokJSnegoL-4_9WSOd5XaoHulwFjqahU5ewG5pUoYzYAX37mR8o8gYB85SO4yo5fOxQv2tgIsXe-F4H7njZdmEnpqg==",
    company: "CodeRoad",
    title: "Senior Frontend Engineer (React Focused)",
    portal: "Greenhouse — Senior Frontend",
    location: "Latin America (100% Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE_5kCLuQ4PwTQ8HKmqEG_gBMKBmwpW68Pfr1oWAhZgZxyqJTIEL_Ykn4OMmIJ_4wkmjeNlQaZbpJqlFgQeS8yQ0I4hZn5ZFZA0ZN6N42wzq9wx3p3NkGL6_Rv3s-I6ExOM1AcEZJOFt5VBZtk=",
    company: "Engine",
    title: "Senior Frontend Engineer - Fintech, Card",
    portal: "Greenhouse — Senior Frontend",
    location: "Remote - LATAM"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHrx9cOXDNiNAdIpQbXBYA3PUIivTOurJhd6xdi6UJuGB0oQkhOHdT4aVYvqSK6Dm-xAOizvxsIDHB6AiOVkOZoThOVdY9P-R06tkWS0vyIeA82UixSXrhafBRMUhaWpF3XTUoSL8WzZ1Y9Qw==",
    company: "Roofr",
    title: "Senior Frontend Engineer - Contract",
    portal: "Greenhouse — Senior Frontend",
    location: "Remote - Colombia"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHuoe60pEuAWviEt5Uu8aehSfj4morWXiKC_Pfdeg28IQL9GMJevdiru4fJbi1fvOggrTfsCL9ZuJCeoUz6oumXV-bZBXToyFEUAna1_-Xq8sF16UG3yzksfB2Zixg1tUaVf7B9SBmZDz8=",
    company: "N-iX",
    title: "Senior Frontend Engineer (React)",
    portal: "Greenhouse — Senior Frontend",
    location: "Office/Remote"
  },

  // Query 5: Greenhouse — Senior Full-Stack
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFsTF4-t_g01MN0R_g59rYvsgasHCZLjZD-btVItUTg4KKmyXgVA-xc8LZLk0VB9xPSpdl9UEpF8snTQaO8W6ZtOuUuMh1JsLiF4AYM3SMH5tEB4HJZEb-8Saa6iIv8ecvu14weAV_-L1Fz6CtZjdg=",
    company: "Nearform",
    title: "Senior Software Engineer - React",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote (United States)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHxEuepB78dPOCSkB4ELiEiz7RAOiVQqu33ViKFZMjiXVAKoemjwjOReGr3M-7AJO_ReO95DUcVGaIqmvpV_ryZUgnpG-zV1aneI7GbSJfv5v9nbIMNsc9sm_CFAanaoT-pxyPtOTbVvy73mA1Wgyol",
    company: "CookUnity",
    title: "Senior Full Stack Engineer, Supply Tech",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote (Latam)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE-u2EFTqe73vfTKXjVyDlG27DnQd7iQHMIP7W8cwaHVUnNfIvBR-eyB67cwkocJozh6c9iGVML4hs4MauzDmpz9jjyA9HXOy3YTqsedcRRPS9_TVmX9Sp9El2TiRC1nAmj3fWokeu3FfHWuw==",
    company: "Samsara",
    title: "Senior Software Engineer - Connected Workflows",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote (United States)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGPB7a37m6YcwCmDilOqBO6V8caV2R1zgUVWdNQSUo14IOtkxSILUn58jOJS8u_jk2HwMNYhBNW0FF030K8kiROVpztHb_UH030W1jusNQ08B5PhfrsW8rcCvVFLQX5fqrxmoFeThxLeuX3vKNABVGu",
    company: "saas.group",
    title: "Senior Software Engineer (Node & React, Headless API)",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote (Europe)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQETbTIFqXR5pzmHIItFdTrrZl3iwraOI6oNMKyCm4ztKgjD00JfmUFzM-wSbUfDgNfQVaRqS8F7-ojrw3znEKFS9HFsGsKYVBqPi3Pm1Wk-kKm1ls2ak0pV1QTwbsEnynLnuhXC2A35zZXlfNM9XA==",
    company: "Serhant",
    title: "Senior Full Stack Engineer",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote (USA)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFqFlkHCQrAChV5uTs-fT3JpZ1ekUtPS4fFDpALdegyBpffnLB3GXJnwYn0KCTBaI5uNa-84FRysLth7_GSFJaYHKZOsYlzeBLmriOhFxe1DvDZCTWqwwrtcQCfRRPqqQvd58Xu3qx_61hHDNLsP2_S_A==",
    company: "ClickHouse",
    title: "Senior Full Stack Engineer - ClickStack",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote (Netherlands)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGOPmwajcsy60AfQ4SJXD3et7rsj9IfBBtTUTVQOAGwVC_irNgcFOjqF5x0LfeTtjRnZLPE8rCAYvFWnDlZpTCvUAwNWf-WCBFQ-YXsQ6UFpRlf5Tppig_r_IXORoWco_ZT19VcUgW2-aMK",
    company: "Reddit",
    title: "Senior Software Engineer - Full Stack Internal Tooling",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote (United States)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGuGyjbLv5z15nKB27lvQJ6F_jlgThoS4oi2NTqIbb55FvqCuX_7uB4-_ISZJ8iWIlGvzFMtCzaEvJCuweCTL-Up1Qyo6l9RAm-eVBSGxHOi00WCYFcNoQbbT3f6TYjDP4g4S6oAMzDOhSO15lViEOdM1AexI8i",
    company: "Underdog",
    title: "Senior Software Engineer - React Native",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote-first"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFKrfCPp8RrYbDT5ldzs8ipgvwE4C2lWqEldJqc_SaiRgipTdsYgXclmTnnjSkXt0UQHqQbLgVN9ooESNOrZcoId9vIWqYs8BvTGZfnNU3Rus4MHnKih1I96GMTcB_H8CdCR96oRPJqXqx9laF2VsnF",
    company: "InsightRX",
    title: "Senior Software Engineer Full-stack",
    portal: "Greenhouse — Senior Full-Stack",
    location: "Remote"
  },

  // Query 6: Lever — Senior Frontend / Full-Stack
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHpLvVdEuj53ysczDXS3zzUCVxN2Eu7j-FDwBbIA8-cdta8jETUZUWw7CWz0QfB6YJE0X2ZwVn5WbzoPAM2FWRa5j7v9eOOOHkvz4fteyh0zFIzuMUzgiRgWZYivFHXi5jLrxM7iMqFs2atSe0EComzD2GFMHU3M4AcEo0e-A==",
    company: "Unknown",
    title: "Senior Frontend Engineer",
    portal: "Lever — Senior Frontend / Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFBDvBN43NRUpx9A_kTn3FCANuKOMTkajHWs5NQalSR_UK1mRw3ZhVTZOh_0KdetWjljK9Xc8MjgQzvJzF43tcH-EwbS7v9zOHFsymdiB8W9zlXqhVAxEmPe1zhODql4_ltUY_RiFDw8arXk_OvT1nVsTGEBBjaZDzgyo3wx-mi55XVwA==",
    company: "Unknown",
    title: "Senior Full Stack Engineer",
    portal: "Lever — Senior Frontend / Full-Stack",
    location: "Remote"
  },

  // Query 7: Workable — Senior Frontend / Full-Stack
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE2VCcutoZZVPDdFcIhiraqzlkoWMX99sqxcgzkwwpzOrX48L8gjMWBVdrM55VHwDoGqMsY4pkpZKJ2m_lpAMJ0FQzy1Ad5X53MNiRg882Z6YcvZssBOoeQOteajxgK0rV0JVLQzHM=",
    company: "Treatwell",
    title: "Senior Frontend Engineer",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGb467BZy4NtRvCoSf64Y-WXD9_d9eQWbwNB5k-pC1_Da-W3MvHQ-MArhmfBBdCdZdgPzmk1suLdL1bTzMFX-872_U5CuEb3YUOCb747Jpy_RuoQdv8lfdrgunlgLplJ82hXqXd-fuxo3Nd",
    company: "Soda Data",
    title: "Senior Frontend Engineer (Full-stack)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Remote (Belgium, Poland, UK, Netherlands, Germany, France)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGZ5E0Hv9vEo78Dij8Q0rdV1G-AZ9ZRQAUqzzewkkPAVvA5m4oBG7EZm5aVq1IMuwdIlzm5Y8WSgOrpUy-7TlyP3yo_eVyNBafS6-Hdh7t1dsXohNM2LXUut9vhp_7YhJt9rA==",
    company: "Fuku",
    title: "Senior Frontend Engineer",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHS0VKvjBnQyszAKWNUGCcdF1D3BwlrzByHitsn1uf2t6mAsZq0A6CYonO-lokpWl68C5U9V3fh2V-3h3jOhBP2aLXRzVSuKIaQclIbwYTVtguZ5S3QNmDq_11byotnnEt-1k0x1KU=",
    company: "AOA",
    title: "Senior Frontend Engineer (React)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Latin America (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFyyEUvK6skr81hLymT2VCZlGkIsZtI61TD4ywNDl1NGNkJn_VlP5788qflnU0IDt6Wudl-56HXEE4ggw-3bz0UGIBgklHvNYef4eevV4SqxHyrKkcvG5I30tUYzhpGlOyOjD0qrw==",
    company: "AOA",
    title: "Senior Frontend Engineer (Shopify)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Latin America (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG34eQkYic48aI35UBdf4QGjgKY-rnNVvVG80jgQu-8veFgPxe_52Lq6qsHLstnjLu2iLF_1xOcyPzFvujIXkGYZWmKmL0zJ8fvjGLU9pianpzQYxJJw9YcO1B1m-VQLwV82P7ltpAnGlc31bME-5g=",
    company: "Simple Machines",
    title: "Senior Frontend Engineer",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Poland"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE8-gRagZMu8gxoAAuYTCFj3nkHX5GE-6HU1cl_-jMiHLqYzKSXeKxcpfKszUTHf7VGtOAL1AXI5gQfKWgibiAnqiflRED0pJo5_GI4fc4SKwjuu1gNrT-GspvL3bjtaWHN-em8LBTjol7WRAu766TkPsRoIg==",
    company: "Pack.com",
    title: "Sr. Frontend Engineer (ReactJS + GraphQL)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Latin America/Poland"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEenwciEj9qu1BAeKcIYUMlnxiA33IESw_TDuZ3z6QqN9BxxSTcnJ-yhzF5tY-Gy5hVgimfJcFTnzwF8EubNHsnZZjXkJKcyHp6TDhZCasQ037yVaKKPzjcqGNqhFbvKOUY_FI1_awQxGONlio=",
    company: "Intuition Machines, Inc.",
    title: "Senior Frontend Engineer",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Argentina (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGil8myXNBD-PO7hCpD3hSGWT3yha7sViFe5zqF5rjg2KqVLZk2obmpEiHq6tWCEMPccWajqxwJ54ND3eBmtfpMzdfTngBze26CwYB_qvR4QTZGBbLHUP5P5-1zV8pi-Xo61SHw0cwJ",
    company: "Pickle",
    title: "Senior Fullstack Engineer",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Remote-first"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGB_ngBcXMbJkOrzQ3YpExiLryM2SS0EskOWI3jDgr1mLJUH0-DPI92VXMysqzOvjGOkWnWtd-edgR3SSKX8nyECkqtl7tcIwTh4HLpiGAidjUSUIRWaoD1bXz5D8sJGQeIDbw=",
    company: "MLabs",
    title: "Senior Full Stack Engineer (Platform)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "NYC or Remote USA/Europe"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEAFGAbieWdv-owvTgsS0qeGYjdTaG1ES-IukNU5ol72mFlmbLkep5dYchld2H8hTrCuNjXh6DyytCxscVLohbg8QJQu4zU0nUOLaY0f3fAvduXFmG3SOl-LCHBb-rC3yVzalZ20vVdtw==",
    company: "talentpluto",
    title: "Senior Full Stack Engineer",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Remote (US)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHZVbuh7vMfJ_wKkQoimbymZqdipQSYo7dWyd8sIow0PPZi_EbAwZK5TV7ZekJ05_bpZO2IzEw_ITANzfoJAAyBJ-3JxY4aHTtlNCZqccV9T42UXDRelhwKYcMaSKeJqZN1MwE/",
    company: "Pavago",
    title: "Senior Full Stack Engineer (Python/FastAPI)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Remote (U.S. Business Hours)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGf3esnRySjOaEdgdL-WRgi_8bY9yc1e7KJ1wP2a5ggWKMXWJeKDbfr-Kr1YDQ34qIphyGRAKzE40R6JncNq9OUWLQqLrPUxC8PJbyRmzeqkn3oATUxJjKL7IUcQv4e1M4SwC50",
    company: "Pavago",
    title: "Senior Full Stack Engineer (Python/FastAPI)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGbNiv7HAgHcBajKAr90sVfTqw84IWWBVCz3WsggEC2JsqHtH0SzjD6-uzKPELdRKjAE_CnEFy2zUaBt6RYjRQ-gMEN4O6iQTthX6t7Nm2eK6cgDQWgaDic-Yn1B56B886PtJl2DHeyxkeACqYDEZ9o",
    company: "Remote Talent LATAM",
    title: "Senior Full Stack Engineer (Backend Focus)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Latin America (Remote)"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGSnX7LZepgkH11FiBS_WgODei9_rvgvi2CN7C1Pw8dDzt8591n2G0etVFmcsnSnTw_dO7wsp6SfNUO3_SU_PUD8TYPPuUsKdabXaxgoyZLX5phR44evGEfMGS-iYcT_24SXTaJ",
    company: "Forager.ai",
    title: "Senior Full Stack Engineer (Python/React)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFasieOG1g_ZooL-MweSzS4TPL3SJMPRwtWJdY_5K08FsWYYokpevKFobQpgf_GDLRPa52cHyew3miGjyKbwI3MtpREuOIk0nzD3crCod9pHuEecB7s3S-Gsrsio6W-Pg_cwZ30jydY",
    company: "Space Inch",
    title: "Senior Full-Stack Engineer (.NET/Angular)",
    portal: "Workable — Senior Frontend / Full-Stack",
    location: "Croatia"
  },

  // Query 8: Greenhouse — Product Engineer
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEImPGP0ypL5_DUV7TpKxmrftiLNt_UNWFpuv-nE8DNT9OAvMqe0JUq5yd4HXzqD8uqs6mtewqLacKycMqKn-jF-nD1DdJXwhyKJ1MTdqGwHQyZpA18tgbxeMGmhBfzaEdJZyZj4T4_6lHWEaH1",
    company: "Cresta Labs",
    title: "Senior Product Engineer",
    portal: "Greenhouse — Product Engineer",
    location: "US (Remote)"
  },

  // Query 10: Ashby — Forward Deployed Engineer
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFpXFEhJv9j49zq2iZ70BJIBgexuSBEUti_0VDktOJqGoHDmhPTfwNpMu6op8IUE0uAHXCNtncAYVOysdbqDhtmgEO2BNTVTpFwE__73CqKVToQK4wQEHU4YHD_bxIVabKBwEAQFTLkpy36UP3P5dPk9pvs4HV5Vl_8QKo=",
    company: "Maybern",
    title: "Forward Deployed Engineer",
    portal: "Ashby — Forward Deployed Engineer",
    location: "Remote"
  },
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFP6rfGLImO7xwRCH4R_PomZytUbfL3ref-Kxw9clRBnpMFjAujCpNnqaZzlX6k4EuPcxmzQJYgjttgC7ZUMzyUQr4xUjxwRCH4R_PomZytUbfL3ref-Kxw9clRBnpMFjAujCpNnqaZzlX6k4EuPcxmzQJYgjttgC7ZUMzyUQr4xUjxuWp1ZY7YGFXjFtE6mMLc_cSYpY_6Bk2-pLQFQAzPDLUm0-JNz1DmiFQ4-XD4qZ8-MLxT28L1_rA==",
    company: "Firecrawl",
    title: "Forward Deployed Engineer",
    portal: "Ashby — Forward Deployed Engineer",
    location: "Hybrid (San Francisco)"
  },

  // Query 11: Greenhouse — Forward Deployed Engineer
  {
    groundingUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHOTgaAn4B01Y3cubpHP-sPBp8NVkA5g0nu749num64xZQkRbwPbpfmsAxb3G_M1oZmBkTQvGyJiUGM2qV_hKn3jbCRl6cowj23lB8-Y_cf-B2JmVOuNsHhYfZeq1JcdEmUP1e02neQBI3DV2JTcGQ=",
    company: "Striim, Inc.",
    title: "Forward Deployed Engineer (FDE)",
    portal: "Greenhouse — Forward Deployed Engineer",
    location: "US (Remote)"
  }
];

// Helper to follow redirect for a URL
async function resolveUrl(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    clearTimeout(timeoutId);
    return res.url;
  } catch (err) {
    // If native fetch fails, try curl as a fallback
    try {
      const stdout = execSync(`curl -Ls -o /dev/null -w "%{url_effective}" "${url}"`, { timeout: 10000 });
      return stdout.toString().trim();
    } catch (curlErr) {
      console.error(`Failed to resolve redirect for ${url}: ${err.message} (curl: ${curlErr.message})`);
      return null;
    }
  }
}

// Function to extract company name from URL if it's Unknown
function inferCompanyFromUrl(resolvedUrl, originalCompany) {
  if (originalCompany && originalCompany !== 'Unknown') return originalCompany;
  try {
    const urlObj = new URL(resolvedUrl);
    // Parse Lever URL like: https://jobs.lever.co/company-name/job-id
    if (urlObj.hostname.includes('lever.co')) {
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
    }
    // Parse Ashby URL like: https://jobs.ashbyhq.com/company-name/job-id
    if (urlObj.hostname.includes('ashbyhq.com')) {
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
    }
    // Parse Greenhouse URL like: https://boards.greenhouse.io/company-name/jobs/job-id
    if (urlObj.hostname.includes('greenhouse.io')) {
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
    }
    // Workable: https://apply.workable.com/company-name/j/job-id
    if (urlObj.hostname.includes('workable.com')) {
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      }
    }
  } catch (e) {
    // Ignore
  }
  return originalCompany || 'Unknown';
}

async function run() {
  const dateStr = '2026-08-13'; // fixed scanning date per instruction
  
  // Load configuration for filters
  const config = yaml.load(fs.readFileSync('portals.yml', 'utf-8'));
  const titleMatcher = buildTitleFilter(config.title_filter);
  const locationMatcher = buildLocationFilter(config.location_filter);
  const canonicalizeCompany = buildCompanyCanonicalizer(config.company_aliases);
  
  // Load seen Urls from the 3 files using the main scanner's function
  const { seen: seenUrls } = loadSeenUrls({});
  const seenCompanyRoles = loadSeenCompanyRoles('data/applications.md', canonicalizeCompany);
  
  // Load scan-history.tsv to specifically check if a URL is already logged there.
  // This helps us avoid logging a URL multiple times in scan-history if it is already there.
  const loggedUrlsInHistory = new Set();
  if (fs.existsSync('data/scan-history.tsv')) {
    const lines = fs.readFileSync('data/scan-history.tsv', 'utf-8').split('\n');
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts[0]) loggedUrlsInHistory.add(parts[0].trim());
    }
  }

  // Tracked companies to discard per instruction "discard any hit whose company matches GitLab, Anthropic, Spotify"
  const resolvedTrackedCompanies = new Set(['gitlab', 'anthropic', 'spotify']);
  
  console.log(`Resolving redirects for ${candidatesRaw.length} candidate URLs...`);
  
  const candidatesResolved = [];
  const processedUrls = new Set(); // to avoid duplicates within this list
  
  // Follow redirects
  for (let i = 0; i < candidatesRaw.length; i++) {
    const raw = candidatesRaw[i];
    const resolved = await resolveUrl(raw.groundingUrl);
    if (!resolved) continue;
    
    // Normalize url
    const normalizedUrl = resolved.trim().split(/\s+/)[0] || '';
    if (!normalizedUrl || processedUrls.has(normalizedUrl)) continue;
    processedUrls.add(normalizedUrl);
    
    const company = inferCompanyFromUrl(normalizedUrl, raw.company);
    candidatesResolved.push({
      url: normalizedUrl,
      company: company,
      title: raw.title,
      portal: raw.portal,
      location: raw.location
    });
  }
  
  console.log(`Resolved ${candidatesResolved.length} unique candidates.`);
  
  const survivors = [];
  const newHistoryLines = [];
  
  // Apply filtering and deduplication
  for (const c of candidatesResolved) {
    const normCompany = canonicalizeCompany(c.company);
    
    // 1. Check if the company matches GitLab, Anthropic, Spotify
    if (resolvedTrackedCompanies.has(normCompany)) {
      console.log(`Discarding tracked company candidate: ${c.company} | ${c.title} (${c.url})`);
      continue;
    }

    // 2. Check if URL is already in scan-history.tsv. If yes, skip completely (no new log).
    if (loggedUrlsInHistory.has(c.url)) {
      console.log(`URL already in scan-history.tsv: ${c.url}`);
      continue;
    }
    
    // 3. Deduplicate against seen sets (pipeline.md or applications.md or companyRole evaluation)
    const companyRoleKey = companyRoleDedupKey(c.company, c.title, canonicalizeCompany);
    const isDupUrl = seenUrls.has(c.url);
    const isDupCompanyRole = seenCompanyRoles.has(companyRoleKey);
    
    if (isDupUrl || isDupCompanyRole) {
      console.log(`Duplicate found: ${c.company} | ${c.title} (${c.url})`);
      newHistoryLines.push(formatScanHistoryRow({
        url: c.url,
        title: c.title,
        company: c.company,
        location: c.location,
        source: c.portal
      }, dateStr, 'skipped_dup'));
      continue;
    }
    
    // 4. Apply title filter
    if (!titleMatcher(c.title)) {
      console.log(`Filtered by title: ${c.title} (${c.company})`);
      newHistoryLines.push(formatScanHistoryRow({
        url: c.url,
        title: c.title,
        company: c.company,
        location: c.location,
        source: c.portal
      }, dateStr, 'skipped_title'));
      continue;
    }
    
    // 5. Apply location filter
    if (!locationMatcher(c.location)) {
      console.log(`Filtered by location: ${c.location} (${c.company} | ${c.title})`);
      newHistoryLines.push(formatScanHistoryRow({
        url: c.url,
        title: c.title,
        company: c.company,
        location: c.location,
        source: c.portal
      }, dateStr, 'skipped_location'));
      continue;
    }
    
    survivors.push(c);
  }
  
  console.log(`Survivors after filters: ${survivors.length}`);
  
  const verifiedActive = [];
  
  if (survivors.length > 0) {
    // Run check-liveness.mjs for survivors in one batch
    const urlsToCheck = survivors.map(s => s.url).join(' ');
    console.log(`Running liveness check: node check-liveness.mjs ${urlsToCheck}`);
    
    let livenessOutput = '';
    try {
      livenessOutput = execSync(`node check-liveness.mjs ${urlsToCheck}`, { stdio: 'pipe' }).toString();
    } catch (err) {
      // check-liveness exits non-zero if there are any expired or uncertain roles
      livenessOutput = err.stdout ? err.stdout.toString() : '';
      if (err.stderr) console.error(err.stderr.toString());
    }
    
    console.log(`Liveness Output:\n${livenessOutput}`);
    
    // Parse liveness output
    // The format is "✅ active     https://..." or "❌ expired    https://..." or "⚠️ uncertain  https://..."
    const lines = livenessOutput.split('\n');
    const activeUrls = new Set();
    const expiredUrls = new Set();
    const uncertainUrls = new Set();
    
    for (const line of lines) {
      if (line.includes('✅ active')) {
        // extract URL
        const match = line.match(/https?:\/\/\S+/);
        if (match) activeUrls.add(match[0].trim());
      } else if (line.includes('❌ expired')) {
        const match = line.match(/https?:\/\/\S+/);
        if (match) expiredUrls.add(match[0].trim());
      } else if (line.includes('⚠️ uncertain')) {
        const match = line.match(/https?:\/\/\S+/);
        if (match) uncertainUrls.add(match[0].trim());
      }
    }
    
    for (const s of survivors) {
      if (activeUrls.has(s.url)) {
        verifiedActive.push(s);
        newHistoryLines.push(formatScanHistoryRow({
          url: s.url,
          title: s.title,
          company: s.company,
          location: s.location,
          source: s.portal
        }, dateStr, 'added'));
      } else {
        // expired or uncertain - drop and record as skipped_expired
        console.log(`Liveness dropped: ${s.company} | ${s.title} (${s.url})`);
        newHistoryLines.push(formatScanHistoryRow({
          url: s.url,
          title: s.title,
          company: s.company,
          location: s.location,
          source: s.portal
        }, dateStr, 'skipped_expired'));
      }
    }
  }
  
  // Write to scan-history.tsv
  if (newHistoryLines.length > 0) {
    console.log(`Writing ${newHistoryLines.length} rows to data/scan-history.tsv`);
    fs.appendFileSync('data/scan-history.tsv', newHistoryLines.join('\n') + '\n', 'utf-8');
  }
  
  // Write to data/pipeline.md
  if (verifiedActive.length > 0) {
    console.log(`Writing ${verifiedActive.length} active offers to data/pipeline.md`);
    let pipelineText = fs.readFileSync('data/pipeline.md', 'utf-8');
    
    // Format Pending list
    const formatOffer = (o) => `- [ ] ${o.url} | ${o.company} | ${o.title}`;
    const block = verifiedActive.map(formatOffer).join('\n') + '\n';
    
    const idx = pipelineText.indexOf('## Pending');
    if (idx === -1) {
      // Append to the end or before ## Processed
      const procIdx = pipelineText.indexOf('## Processed');
      const insertAt = procIdx === -1 ? pipelineText.length : procIdx;
      pipelineText = pipelineText.slice(0, insertAt) + `\n## Pending\n\n` + block + '\n' + pipelineText.slice(insertAt);
    } else {
      const afterMarker = idx + '## Pending'.length;
      const nextSection = pipelineText.indexOf('\n## ', afterMarker);
      const insertAt = nextSection === -1 ? pipelineText.length : nextSection;
      pipelineText = pipelineText.slice(0, insertAt) + '\n' + block + pipelineText.slice(insertAt);
    }
    fs.writeFileSync('data/pipeline.md', pipelineText, 'utf-8');
  }
  
  console.log(`\nPortal Scan Broad — ${dateStr}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`New added to pipeline.md: ${verifiedActive.length}`);
  for (const o of verifiedActive) {
    console.log(`  + ${o.company} | ${o.title} | ${o.portal}`);
  }
  
  const verdictScore = verifiedActive.length > 0 ? 5 : 2;
  console.log(`\nVERDICT: ${verdictScore}/5 — ${verifiedActive.length} new role(s) added to your inbox`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
